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
 *  service's unattended use: its caps, its record). Each post hands the
 *  model what Elixir knows (2026-10-11): the clan (`clanContext`: its
 *  name, words, goals, members and last war weeks), the item's facts,
 *  its member's record (`clanStoryFacts`: with the awards the clan
 *  announced and, while the channel posts milestones, their last three
 *  moments) and how often the channel told of them this week. A run of same-kind milestones is one post, keyed
 *  by its first item, so the relay edits it in place like any other. A
 *  line the model does not return, or one that fails the engine's
 *  checks, keeps Elixir's own sentence (a group: Elixir's lines, one
 *  under the other); so does every line when the model cannot be used.
 *  The stamp and the links are always Elixir's.
 *
 *  The model is asked outside any transaction: the run plans under the
 *  row's lock and commits, asks, then writes under the lock again, and
 *  writes nothing when the connection changed meanwhile. A session lock
 *  per clan keeps one run at a time across the wait. */
import { DISCORD_CONTENT_MAX, DISCORD_POSTS_MAX } from "@elixir-mcp/contracts";
import {
  ACTIVITY_CATEGORIES,
  DEPARTURE_CLASSIFIED,
  REWRITE_BATCH_MAX,
  activityCategories,
  activityRewriteRequest,
  activityRewritesFromDraft,
  activityShareable,
  clanContext,
  declaredGoals,
  groupable,
  rewriteLine,
} from "@elixir-mcp/clan-engine";
import {
  buildTimeline,
  isPublishable,
  timelineNews,
} from "@elixir-mcp/tools/activity/entries";
import { battleLinks } from "@elixir-mcp/record/battle-links";
import { discordLine, itemBattleId, itemSentence } from "./lines.mjs";
import { postRevision, readCapped } from "./sync.mjs";
import { clanStoryFacts } from "./story-facts.mjs";

const DAY_MS = 24 * 3600_000;
const REACH_MS = 30 * DAY_MS;
const TOLD_KEEP_DAYS = 31;
/** A departure's post edited by a leader's word on it: above any
 *  revision the roster's own item reaches. */
const CLASSIFIED_REVISION = 1000;
/** A leader's word on a departure edits the departure nearest it, within
 *  this much (its left_at, or the word itself for a removal). */
const DEPARTURE_NEAR_MS = DAY_MS;
/** Same-kind milestones told as one post, at most. */
const GROUP_MAX = 5;
/** A member's recent moments told with a rewritten post, and for how
 *  many of a run's members (each is one timeline read before the
 *  model's wait). */
const REWRITE_MOMENTS_MAX = 3;
const REWRITE_MOMENT_MEMBERS = 8;
/** The posts a leader may preview in the clan's voice. */
const PREVIEW_MAX = 5;
/** How far back the channel's history about a member is told. */
const HISTORY_MS = 7 * DAY_MS;
/** The session lock's namespace ("clan"), beside the clan's tag. */
const LOCK_NS = 0x636c616e;

const observedMs = (it) => Date.parse(it.observed_at ?? it.at);
const memberTag = (it) => it.facts?.player_tag ?? null;

/** The wake id for a clan: its tag without the #, which S3 keys and
 *  queue logs read plainly. */
export const clanWakeId = (clanTag) => `clan-${String(clanTag).slice(1)}`;

async function inTransaction(db, fn) {
  await db.query("begin");
  try {
    const out = await fn();
    await db.query("commit");
    return out;
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

const ROW_SQL = `select d.channel_id, d.webhook_sealed, d.webhook_fp, d.enabled,
            d.enabled_at, d.synced_to, d.updated_at, d.categories,
            d.rewrite, d.voice, c.name as clan_name
       from clan_activity_discord d
       left join clan c on c.clan_tag = d.clan_tag
      where d.clan_tag = $1`;

/**
 * @param {import("pg").ClientBase} db
 * @param {string} clanTag
 * @param {{
 *   outbox: Function,
 *   readStatus?: (channelId: string) => Promise<object|null>,
 *   policyFor: (db: any, clanTag: string) => Promise<object|null>,
 *   pitchFor?: ((db: any, clanTag: string) => Promise<object|null>) | null,
 *   rewrite?: ((db: any, clanTag: string, request: object) =>
 *     Promise<{ ok: boolean, input?: object, code?: string }>) | null,
 *   now?: number,
 * }} deps
 */
export async function syncClan(db, clanTag, given) {
  const deps = { ...given, now: given.now ?? Date.now() };
  // One run per clan at a time, held across the model's wait without a
  // transaction or a row lock (a leader's save is never held up by it).
  await db.query("select pg_advisory_lock($1, hashtext($2))", [
    LOCK_NS,
    clanTag,
  ]);
  try {
    const plan = await inTransaction(db, async () => {
      const p = await planRun(db, clanTag, deps);
      if (p.out || p.request) return p;
      return { out: await writeRun(db, clanTag, deps, p, null) };
    });
    if (plan.out) return plan.out;
    const r = await deps
      .rewrite(db, clanTag, plan.request)
      .catch(() => ({ ok: false, code: "error" }));
    return await inTransaction(db, async () => {
      // The connection as it is now: written only while it is the same.
      const {
        rows: [row],
      } = await db.query(`${ROW_SQL} for update of d`, [clanTag]);
      if (
        !row?.enabled ||
        row.webhook_fp !== plan.row.webhook_fp ||
        row.synced_to.getTime() !== plan.row.synced_to.getTime()
      )
        return { skipped: "changed", rewrite_code: r?.ok ? null : r?.code };
      return writeRun(db, clanTag, deps, { ...plan, row }, r);
    });
  } finally {
    await db
      .query("select pg_advisory_unlock($1, hashtext($2))", [LOCK_NS, clanTag])
      .catch(() => {});
  }
}

/** The categories in effect and the kinds they post. */
async function postingKinds(db, clanTag, row, policyFor) {
  const policy = await policyFor(db, clanTag);
  const categories = activityCategories(row.categories, policy?.values ?? null);
  const kinds = Object.entries(categories)
    .filter(([, on]) => on)
    .flatMap(([key]) => ACTIVITY_CATEGORIES[key].kinds);
  if (categories.members) kinds.push(DEPARTURE_CLASSIFIED);
  return { categories, kinds, policy };
}

/** The item a post is nearest to `ms`, within the departure window. */
function nearest(list, ms, atOf) {
  let best = null;
  let gap = Infinity;
  for (const x of list) {
    const d = Math.abs(atOf(x) - ms);
    if (Number.isFinite(d) && d <= DEPARTURE_NEAR_MS && d < gap) {
      best = x;
      gap = d;
    }
  }
  return best;
}

/**
 * The run under the row's lock: what to post (each post a key, a
 * revision and its items), what to record as told, and, with the
 * rewrite on, the request for the clan's model. `out` when the run is
 * over before posting anything.
 */
async function planRun(
  db,
  clanTag,
  {
    readStatus = async () => null,
    policyFor,
    pitchFor = null,
    rewrite = null,
    now = Date.now(),
  },
) {
  const {
    rows: [row],
  } = await db.query(`${ROW_SQL} for update of d`, [clanTag]);
  if (!row || !row.enabled) return { out: { skipped: "off" } };

  const status = await readStatus(row.channel_id);
  if (
    (status?.state === "gone" || status?.state === "forum") &&
    status.webhook === row.webhook_fp &&
    Date.parse(status.at) >= row.updated_at.getTime()
  ) {
    // A forum channel's webhook takes no plain message (2026-10-11).
    const reason = status.state === "forum" ? "webhook_forum" : "webhook_gone";
    await db.query(
      `update clan_activity_discord
          set enabled = false, disabled_reason = $3,
              disabled_at = $2
        where clan_tag = $1`,
      [clanTag, new Date(now), reason],
    );
    return { out: { disabled: reason } };
  }

  // What is on: the leaders' switches over the policy's defaults. No
  // policy, or nothing on, posts nothing, and the pointer moves on (no
  // backfill when a category is turned on later).
  const { categories, kinds, policy } = await postingKinds(
    db,
    clanTag,
    row,
    policyFor,
  );
  if (!kinds.length) {
    await advance(db, clanTag, now);
    return { out: { skipped: "nothing_on" } };
  }

  const enabledMs = row.enabled_at.getTime();
  const fromMs = Math.max(enabledMs, now - REACH_MS, row.synced_to.getTime());
  let toMs = now;
  const subjects = [{ kind: "clan", tag: clanTag, scope: "comprehensive" }];
  const wanted = (it) =>
    isPublishable(it) &&
    (activityShareable(it, categories) ||
      (it.kind === DEPARTURE_CLASSIFIED && categories.members));
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

  // A post: the key and revision it goes under, and the items it tells.
  const posts = fresh.map((it) => ({
    key: it.id,
    revision: postRevision(it),
    items: [it],
  }));
  const toldNow = fresh.map((it) => ({
    item_id: it.id,
    revision: postRevision(it),
    kind: it.kind,
    player_tag: memberTag(it),
    item_at: it.at ?? null,
  }));
  for (const c of classified) {
    toldNow.push({
      item_id: c.id,
      revision: 1,
      kind: c.kind,
      player_tag: memberTag(c),
      item_at: c.at ?? null,
    });
    const tag = memberTag(c);
    if (!tag) continue;
    // The departure this word is about: the one nearest its left_at (a
    // leader's answer to a departure) or the word itself (a removal,
    // said as it is done), never just the player's latest.
    const target = Date.parse(c.facts?.left_at ?? c.at);
    // Posted in this run: post it once, as the leader told it.
    const here = nearest(
      posts.filter(
        (p) =>
          p.items[0].kind === "member_left" && memberTag(p.items[0]) === tag,
      ),
      target,
      (p) => Date.parse(p.items[0].at),
    );
    if (here) {
      here.items = [c];
      here.revision = CLASSIFIED_REVISION + 1;
      toldNow.find((t) => t.item_id === here.key).revision = here.revision;
      continue;
    }
    // Posted before: edit that post. A row told before 0220 has no
    // time; it is used only when it is the player's one departure.
    const { rows } = await db.query(
      `select item_id, revision, item_at from clan_activity_discord_told
        where clan_tag = $1 and kind = 'member_left' and player_tag = $2`,
      [clanTag, tag],
    );
    const left =
      nearest(
        rows.filter((r) => r.item_at),
        target,
        (r) => r.item_at.getTime(),
      ) ?? (rows.length === 1 && !rows[0].item_at ? rows[0] : null);
    if (!left) continue;
    const revision = Math.max(left.revision, CLASSIFIED_REVISION) + 1;
    posts.push({ key: left.item_id, revision, items: [c] });
    toldNow.push({
      item_id: left.item_id,
      revision,
      kind: "member_left",
      player_tag: tag,
      item_at: left.item_at ? left.item_at.toISOString() : null,
    });
  }

  const plan = { row, posts, toldNow, toMs, narrowed, request: null };
  if (!posts.length || !row.rewrite || !rewrite) return plan;

  // With the rewrite on, a run of never-told milestones of one kind is
  // one post under its first item's key.
  const grouped = [];
  const runs = new Map();
  for (const p of posts) {
    const it = p.items[0];
    if (p.items.length === 1 && !told.has(it.id) && groupable(it)) {
      const run = runs.get(it.kind);
      if (run && run.items.length < GROUP_MAX) {
        run.items.push(it);
        run.revision = Math.max(run.revision, p.revision);
        continue;
      }
      runs.set(it.kind, p);
    }
    grouped.push(p);
  }
  plan.posts = grouped;
  const batch = grouped.slice(0, REWRITE_BATCH_MAX);
  const built = await rewritePackets(db, clanTag, row, batch, {
    policy,
    pitchFor,
    now,
    // A member's recent moments only while the channel posts milestones:
    // the leaders' switch holds for what the model may tell, too.
    moments: categories.milestones === true,
  });
  plan.lines = built.lines;
  plan.request = activityRewriteRequest({
    context: built.context,
    lines: built.lines,
  });
  return plan;
}

/**
 * What the clan's model is told for some posts: the clan block (the
 * cached prefix) and one packet per post, with its members' records and
 * what the channel already told of them this week.
 */
async function rewritePackets(
  db,
  clanTag,
  row,
  posts,
  { policy = null, pitchFor = null, now = Date.now(), moments = false } = {},
) {
  const tags = [
    ...new Set(posts.flatMap((p) => p.items.map(memberTag)).filter(Boolean)),
  ];
  // One pg client: one query at a time (docs/ENGINEERING.md). Moments
  // are one timeline read per member inside the timeline-sync Lambda's
  // budget, before the model's wait: a few, for the first members, and
  // never the items this run is posting.
  const story = await clanStoryFacts(db, clanTag, {
    playerTags: tags,
    nowMs: now,
    moments: moments && {
      max: REWRITE_MOMENTS_MAX,
      members: REWRITE_MOMENT_MEMBERS,
      except: posts.flatMap((p) => [p.key, ...p.items.map((it) => it.id)]),
    },
  });
  const pitch = pitchFor ? await pitchFor(db, clanTag).catch(() => null) : null;
  const history = tags.length
    ? (
        await db.query(
          `select kind, player_tag, count(*)::int as n
             from clan_activity_discord_told
            where clan_tag = $1 and player_tag = any($2::text[])
              and told_at > $3
            group by kind, player_tag`,
          [clanTag, tags, new Date(now - HISTORY_MS)],
        )
      ).rows
    : [];
  const context = clanContext({
    name: row.clan_name,
    pitch: pitch?.values ?? null,
    voice: row.voice,
    goals: policy ? declaredGoals(policy.values) : [],
    facts: story.clan,
  });
  const told = (kind, tag) =>
    history.find((h) => h.kind === kind && h.player_tag === tag)?.n ?? 0;
  const lines = posts.map((p) => {
    const departing = p.items.some(
      (it) => it.kind === "member_left" || it.kind === DEPARTURE_CLASSIFIED,
    );
    const people = [...new Set(p.items.map(memberTag).filter(Boolean))];
    return rewriteLine(
      p.items.map((it) => ({ ...it, id: p.key })),
      p.items.map(itemSentence),
      {
        members: people
          .map((tag) => story.members[tag])
          .filter(Boolean)
          .map((m) =>
            departing
              ? {
                  ...m,
                  scope: "contribution",
                  war: m.war.filter((w) => w.decks_used > 0),
                }
              : m,
          ),
        history: people.map((tag) => ({
          kind: p.items[0].kind,
          name: story.members[tag]?.name ?? tag,
          // A grown item was told before: itself is not "another".
          count: Math.max(
            0,
            told(p.items[0].kind, tag) - (p.revision > 1 ? 1 : 0),
          ),
        })),
      },
    );
  });
  return { context, lines };
}

/** Move the clan's pointer on to `toMs`. */
const advance = (db, clanTag, toMs) =>
  db.query(
    `update clan_activity_discord set synced_to = greatest(synced_to, $2)
      where clan_tag = $1`,
    [clanTag, new Date(toMs)],
  );

/**
 * The planned posts written: each in the model's words when it passed
 * the engine's checks, Elixir's otherwise; recorded as told; the
 * pointer moved on.
 */
async function writeRun(
  db,
  clanTag,
  { outbox, now = Date.now() },
  { row, posts, toldNow, toMs, narrowed, lines = [], request = null },
  r,
) {
  let rewrites = new Map();
  let refused = {};
  let rewriteCode = null;
  if (request) {
    if (r?.ok)
      ({ rewrites, refused } = activityRewritesFromDraft(
        r.input,
        lines,
        request.context,
      ));
    else rewriteCode = r?.code ?? "error";
  }
  if (posts.length) {
    const battles = await battleLinks(
      db,
      posts.flatMap((p) => p.items.map(itemBattleId)).filter(Boolean),
    );
    const line = (it, text = null) =>
      discordLine(it, {
        battles,
        clanTags: new Set([clanTag]),
        nowMs: now,
        text,
      });
    const content = posts.map((p) => ({
      key: p.key,
      revision: p.revision,
      content:
        p.items.length > 1 && !rewrites.has(p.key)
          ? // A group the model did not write: Elixir's lines, stacked.
            p.items
              .map((it) => line(it))
              .join("\n")
              .slice(0, DISCORD_CONTENT_MAX)
          : line(p.items[0], rewrites.get(p.key) ?? null),
      ...(rewrites.has(p.key) ? { rewritten: true } : {}),
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
              (clan_tag, item_id, revision, kind, player_tag, item_at, told_at)
       select $1, x.item_id, x.revision, x.kind, x.player_tag, x.item_at, $2
         from unnest($3::text[], $4::int[], $5::text[], $6::text[],
                     $7::timestamptz[])
           as x(item_id, revision, kind, player_tag, item_at)
       on conflict (clan_tag, item_id) do update
          set revision = greatest(clan_activity_discord_told.revision,
                                  excluded.revision),
              item_at = coalesce(excluded.item_at,
                                 clan_activity_discord_told.item_at),
              told_at = excluded.told_at`,
      [
        clanTag,
        new Date(now),
        toldNow.map((t) => t.item_id),
        toldNow.map((t) => t.revision),
        toldNow.map((t) => t.kind),
        toldNow.map((t) => t.player_tag),
        toldNow.map((t) => t.item_at),
      ],
    );
  await db.query(
    `delete from clan_activity_discord_told
      where clan_tag = $1 and told_at < $2`,
    [clanTag, new Date(now - TOLD_KEEP_DAYS * DAY_MS)],
  );
  await advance(db, clanTag, toMs);
  if (narrowed)
    await outbox(
      "timeline-sync",
      { v: 1, clan_tag: clanTag },
      { id: `${clanWakeId(clanTag)}.${now}.more` },
    );
  return {
    posted: posts.length,
    rewritten: rewrites.size,
    refused,
    rewrite_code: rewriteCode,
    narrowed,
  };
}

/**
 * The clan's last few posts as its model would write them now, for a
 * leader to preview the voice (2026-10-11): the newest `PREVIEW_MAX`
 * items the channel posts, from the last week, each with Elixir's line,
 * and the request that rewrites them. Nothing is posted or recorded
 * here; the leader's use of the model is recorded by the model service.
 * `{ empty: true }` when there is nothing to preview.
 */
export async function clanRewritePreview(
  db,
  clanTag,
  { policyFor, pitchFor = null, voice = undefined, now = Date.now() },
) {
  const {
    rows: [row],
  } = await db.query(ROW_SQL, [clanTag]);
  if (!row) return { empty: true, reason: "not_connected" };
  const { categories, kinds, policy } = await postingKinds(
    db,
    clanTag,
    row,
    policyFor,
  );
  if (!kinds.length) return { empty: true, reason: "nothing_on" };
  const { timeline } = await buildTimeline(
    db,
    [{ kind: "clan", tag: clanTag, scope: "comprehensive" }],
    {
      fromMs: now - HISTORY_MS,
      toMs: now,
      clanMember: true,
      filter: (it) =>
        isPublishable(it) &&
        it.kind !== DEPARTURE_CLASSIFIED &&
        activityShareable(it, categories),
    },
  );
  const items = [...timeline]
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))
    .slice(0, PREVIEW_MAX)
    .reverse();
  if (!items.length) return { empty: true, reason: "nothing_recent" };
  const posts = items.map((it) => ({
    key: it.id,
    revision: postRevision(it),
    items: [it],
  }));
  const built = await rewritePackets(
    db,
    clanTag,
    // The voice being written in the page, when the leader is trying one.
    voice === undefined ? row : { ...row, voice },
    posts,
    // Told what a real post is told.
    { policy, pitchFor, now, moments: categories.milestones === true },
  );
  return {
    empty: false,
    lines: built.lines,
    posts: items.map((it) => ({
      key: it.id,
      kind: it.kind,
      at: it.at,
      elixir: itemSentence(it),
    })),
    request: activityRewriteRequest({
      context: built.context,
      lines: built.lines,
    }),
  };
}
