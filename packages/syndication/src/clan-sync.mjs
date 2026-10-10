/** A clan's activity, brought up to date in the clan's own Discord
 *  channel (Clan Settings, Social; Jamie, 2026-10-10: a lighter,
 *  in-Elixir version of the elixir-mcp-discord agent, "event driven not
 *  schedule based on activity landing in the clan timeline").
 *
 *  Run by the timeline-sync Lambda when a wake (wake.mjs) names the clan.
 *  It reads the clan's timeline as its members read it (`clanMember`:
 *  clan-visible facts, never a leaders-only one), from its own pointer,
 *  keeps the categories in effect (the leaders' switches over the
 *  policy's defaults, `activityCategories`), and writes timeline-discord/
 *  outbox objects of kind `clan_activity` for the relay, which posts a
 *  new item and edits a grown one, as it does for a person's timeline.
 *
 *  A departure is posted as the roster tells it ("departed"); a leader's
 *  word on it is never a post of its own: it edits the departure's post
 *  to say "was removed" or "left on their own" (Jamie: a kick is never
 *  told as a leave). When both arrive in one run, the departure is
 *  posted once, already classified.
 *
 *  With the rewrite on, the clan's own model rewrites the run's lines in
 *  the leaders' voice before they are written (`rewrite`, the model
 *  service's unattended use: its caps, its record). A line the model
 *  does not return, or one that fails the engine's checks, keeps
 *  Elixir's own sentence; so does every line when the model cannot be
 *  used. The stamp and the links are always Elixir's. */
import { DISCORD_POSTS_MAX } from "@elixir-mcp/contracts";
import {
  ACTIVITY_CATEGORIES,
  DEPARTURE_CLASSIFIED,
  REWRITE_BATCH_MAX,
  activityCategories,
  activityRewriteRequest,
  activityRewritesFromDraft,
  activityShareable,
  rewriteLine,
} from "@elixir-mcp/clan-engine";
import {
  buildTimeline,
  timelineNews,
} from "@elixir-mcp/tools/activity/entries";
import { battleLinks } from "@elixir-mcp/record/battle-links";
import { discordLine, itemBattleId, itemSentence } from "./lines.mjs";
import { postRevision, readCapped } from "./sync.mjs";

const DAY_MS = 24 * 3600_000;
const REACH_MS = 30 * DAY_MS;
const TOLD_KEEP_DAYS = 31;
/** A departure's post edited by a leader's word on it: above any
 *  revision the roster's own item reaches. */
const CLASSIFIED_REVISION = 1000;

const observedMs = (it) => Date.parse(it.observed_at ?? it.at);
const memberTag = (it) => it.facts?.player_tag ?? null;

/** The wake id for a clan: its tag without the #, which S3 keys and
 *  queue logs read plainly. */
export const clanWakeId = (clanTag) => `clan-${String(clanTag).slice(1)}`;

/**
 * @param {import("pg").ClientBase} db
 * @param {string} clanTag
 * @param {{
 *   outbox: Function,
 *   readStatus?: (channelId: string) => Promise<object|null>,
 *   policyFor: (db: any, clanTag: string) => Promise<object|null>,
 *   rewrite?: ((db: any, clanTag: string, request: object) =>
 *     Promise<{ ok: boolean, input?: object, code?: string }>) | null,
 *   now?: number,
 * }} deps
 */
export async function syncClan(db, clanTag, deps) {
  await db.query("begin");
  try {
    const out = await syncLocked(db, clanTag, deps);
    await db.query("commit");
    return out;
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

async function syncLocked(
  db,
  clanTag,
  {
    outbox,
    readStatus = async () => null,
    policyFor,
    rewrite = null,
    now = Date.now(),
  },
) {
  // One sync per clan at a time.
  const {
    rows: [row],
  } = await db.query(
    `select d.channel_id, d.webhook_sealed, d.webhook_fp, d.enabled,
            d.enabled_at, d.synced_to, d.updated_at, d.categories,
            d.rewrite, d.voice, c.name as clan_name
       from clan_activity_discord d
       left join clan c on c.clan_tag = d.clan_tag
      where d.clan_tag = $1
        for update of d`,
    [clanTag],
  );
  if (!row || !row.enabled) return { skipped: "off" };

  const status = await readStatus(row.channel_id);
  if (
    status?.state === "gone" &&
    status.webhook === row.webhook_fp &&
    Date.parse(status.at) >= row.updated_at.getTime()
  ) {
    await db.query(
      `update clan_activity_discord
          set enabled = false, disabled_reason = 'webhook_gone',
              disabled_at = $2
        where clan_tag = $1`,
      [clanTag, new Date(now)],
    );
    return { disabled: "webhook_gone" };
  }

  const advance = (toMs) =>
    db.query(
      `update clan_activity_discord set synced_to = greatest(synced_to, $2)
        where clan_tag = $1`,
      [clanTag, new Date(toMs)],
    );
  // What is on: the leaders' switches over the policy's defaults. No
  // policy, or nothing on, posts nothing, and the pointer moves on (no
  // backfill when a category is turned on later).
  const categories = activityCategories(
    row.categories,
    (await policyFor(db, clanTag))?.values ?? null,
  );
  const kinds = Object.entries(categories)
    .filter(([, on]) => on)
    .flatMap(([key]) => ACTIVITY_CATEGORIES[key].kinds);
  if (categories.members) kinds.push(DEPARTURE_CLASSIFIED);
  if (!kinds.length) {
    await advance(now);
    return { skipped: "nothing_on" };
  }

  const enabledMs = row.enabled_at.getTime();
  const fromMs = Math.max(enabledMs, now - REACH_MS, row.synced_to.getTime());
  let toMs = now;
  const subjects = [{ kind: "clan", tag: clanTag, scope: "comprehensive" }];
  const wanted = (it) =>
    activityShareable(it, categories) ||
    (it.kind === DEPARTURE_CLASSIFIED && categories.members);
  let narrowed = false;
  let items = [];
  if (
    fromMs < toMs &&
    (await timelineNews(db, subjects, { fromMs, toMs, kinds })).any
  ) {
    const got = await readCapped(
      (from, to) =>
        buildTimeline(db, subjects, {
          fromMs: from,
          toMs: to,
          clanMember: true,
          filter: wanted,
        }),
      fromMs,
      toMs,
    );
    ({ toMs, narrowed } = got);
    items = got.timeline.filter((it) => observedMs(it) > enabledMs);
  }

  const { rows: toldRows } = await db.query(
    `select item_id, revision from clan_activity_discord_told
      where clan_tag = $1 and item_id = any($2::text[])`,
    [clanTag, items.map((it) => it.id)],
  );
  const told = new Map(toldRows.map((r) => [r.item_id, r.revision]));
  const byTime = (a, b) => (a.at ?? "").localeCompare(b.at ?? "");
  const fresh = items
    .filter(
      (it) =>
        it.kind !== DEPARTURE_CLASSIFIED &&
        (told.get(it.id) ?? 0) < postRevision(it),
    )
    .sort(byTime);
  const classified = items
    .filter((it) => it.kind === DEPARTURE_CLASSIFIED && !told.has(it.id))
    .sort(byTime);

  // A post: the item it tells, the key and revision it goes under.
  const posts = fresh.map((it) => ({
    item: it,
    key: it.id,
    revision: postRevision(it),
  }));
  const toldNow = fresh.map((it) => ({
    item_id: it.id,
    revision: postRevision(it),
    kind: it.kind,
    player_tag: memberTag(it),
  }));
  for (const c of classified) {
    toldNow.push({
      item_id: c.id,
      revision: 1,
      kind: c.kind,
      player_tag: memberTag(c),
    });
    const tag = memberTag(c);
    if (!tag) continue;
    // Posted in this run: post it once, as the leader told it.
    const here = posts.findLast(
      (p) => p.item.kind === "member_left" && memberTag(p.item) === tag,
    );
    if (here) {
      here.item = c;
      here.revision = CLASSIFIED_REVISION + 1;
      toldNow.find((t) => t.item_id === here.key).revision = here.revision;
      continue;
    }
    // Posted before: edit that post.
    const {
      rows: [left],
    } = await db.query(
      `select item_id, revision from clan_activity_discord_told
        where clan_tag = $1 and kind = 'member_left' and player_tag = $2
        order by told_at desc limit 1`,
      [clanTag, tag],
    );
    if (!left) continue;
    const revision = Math.max(left.revision, CLASSIFIED_REVISION) + 1;
    posts.push({ item: c, key: left.item_id, revision });
    toldNow.push({
      item_id: left.item_id,
      revision,
      kind: "member_left",
      player_tag: tag,
    });
  }

  let rewritten = 0;
  let refused = {};
  let rewriteCode = null;
  if (posts.length) {
    // The clan's model, when the leaders turned it on: one request for
    // the run's first REWRITE_BATCH_MAX lines; the rest keep Elixir's.
    let rewrites = new Map();
    if (row.rewrite && rewrite) {
      const lines = posts
        .slice(0, REWRITE_BATCH_MAX)
        .map((p) =>
          rewriteLine({ ...p.item, id: p.key }, itemSentence(p.item)),
        );
      const r = await rewrite(
        db,
        clanTag,
        activityRewriteRequest({
          clanName: row.clan_name,
          voice: row.voice,
          lines,
        }),
      ).catch(() => ({ ok: false, code: "error" }));
      if (r?.ok) {
        ({ rewrites, refused } = activityRewritesFromDraft(r.input, lines));
        rewritten = rewrites.size;
      } else rewriteCode = r?.code ?? "error";
    }
    const battles = await battleLinks(
      db,
      posts.map((p) => itemBattleId(p.item)).filter(Boolean),
    );
    const content = posts.map((p) => ({
      key: p.key,
      revision: p.revision,
      content: discordLine(p.item, {
        battles,
        clanTags: new Set([clanTag]),
        nowMs: now,
        text: rewrites.get(p.key) ?? null,
      }),
    }));
    for (let i = 0; i < content.length; i += DISCORD_POSTS_MAX)
      await outbox(
        "timeline-discord",
        {
          v: 1,
          kind: "clan_activity",
          account_id: row.channel_id,
          webhook: row.webhook_sealed,
          posts: content.slice(i, i + DISCORD_POSTS_MAX),
        },
        { id: `${clanWakeId(clanTag)}.${now}.${i / DISCORD_POSTS_MAX}` },
      );
  }
  if (toldNow.length)
    await db.query(
      `insert into clan_activity_discord_told
              (clan_tag, item_id, revision, kind, player_tag, told_at)
       select $1, x.item_id, x.revision, x.kind, x.player_tag, $2
         from unnest($3::text[], $4::int[], $5::text[], $6::text[])
           as x(item_id, revision, kind, player_tag)
       on conflict (clan_tag, item_id) do update
          set revision = greatest(clan_activity_discord_told.revision,
                                  excluded.revision),
              told_at = excluded.told_at`,
      [
        clanTag,
        new Date(now),
        toldNow.map((t) => t.item_id),
        toldNow.map((t) => t.revision),
        toldNow.map((t) => t.kind),
        toldNow.map((t) => t.player_tag),
      ],
    );
  await db.query(
    `delete from clan_activity_discord_told
      where clan_tag = $1 and told_at < $2`,
    [clanTag, new Date(now - TOLD_KEEP_DAYS * DAY_MS)],
  );
  await advance(toMs);
  if (narrowed)
    await outbox(
      "timeline-sync",
      { v: 1, clan_tag: clanTag },
      { id: `${clanWakeId(clanTag)}.${now}.more` },
    );
  return {
    posted: posts.length,
    rewritten,
    refused,
    rewrite_code: rewriteCode,
    narrowed,
  };
}
