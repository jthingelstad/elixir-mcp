/** A clan's activity, told in the clan's own Discord channel (Clan
 *  ▸ Social ▸ Discord; Jamie, 2026-10-10: a lighter, in-Elixir version of
 *  the elixir-mcp-discord agent, "event driven not schedule based on
 *  activity landing in the clan timeline").
 *
 *  The channel is an editor, not a syndication of the timeline (Jamie,
 *  2026-10-11: "it can't just be syndication of the timeline ... it can
 *  either use AI or it can use some code to figure out a better way to
 *  frame up what's happening"). Each run groups the clan's new timeline
 *  items into stories (`buildStories`, clan-engine stories.mjs): one
 *  member's one battle, same-kind milestones across members, a sitting
 *  that grows. It skips some by rule, each skip and its reason recorded
 *  in the delivery history, holds a story until it has been quiet a few
 *  minutes (a wake on the timeline-hold queue, which delays it five), and
 *  edits a story's post in place only when the story truly grows.
 *  Elixir writes each story itself (`renderStory`, with what the record
 *  adds: `storyContext`), with no clock time and no link; the timeline
 *  cross-post (sync.mjs) keeps its one line per item, links and all.
 *
 *  Run by the timeline-sync Lambda when a wake (wake.mjs) names the clan.
 *  It reads the clan's timeline as its members read it (`clanMember`:
 *  clan-visible facts, never a leaders-only one), from its own pointer,
 *  keeps the categories in effect (the leaders' switches over the
 *  policy's defaults, `activityCategories`), and writes timeline-discord/
 *  outbox objects of kind `clan_activity` for the relay, which posts a
 *  new story and edits a grown one.
 *
 *  A departure is posted as the roster tells it ("departed"); a leader's
 *  word on it is never a post of its own: it edits the departure's post
 *  to say "was removed" or "left on their own" (Jamie: a kick is never
 *  told as a leave). When both arrive in one run, the departure is
 *  posted once, already classified.
 *
 *  With the rewrite on, the clan's own model rewrites the run's stories
 *  in the leaders' voice before they are written (`rewrite`, the model
 *  service's unattended use: its caps, its record), told Elixir's own
 *  post for each and what Elixir knows: the clan (`clanContext`), the
 *  items' facts, its members' records (`clanStoryFacts`) and how often
 *  the channel told of them this week. A post the model does not return,
 *  or one that fails the engine's checks, is Elixir's own; so is every
 *  post when the model cannot be used.
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
  STORY_RETOLD_MS,
  STORY_SKIPS,
  activityCategories,
  activityCategory,
  activityRewriteRequest,
  activityRewritesFromDraft,
  activityShareable,
  buildStories,
  clanContext,
  declaredGoals,
  escapeDiscord,
  leadSafe,
  renderStory,
  rewriteLine,
  storyBattleId,
  storyReady,
  storyValue,
} from "@elixir-mcp/clan-engine";
import {
  buildTimeline,
  isPublishable,
  timelineNews,
} from "@elixir-mcp/tools/activity/entries";
import { postRevision, readCapped } from "./sync.mjs";
import { clanStoryFacts } from "./story-facts.mjs";
import { storyContext } from "./story-context.mjs";

const DAY_MS = 24 * 3600_000;
const REACH_MS = 30 * DAY_MS;
const TOLD_KEEP_DAYS = 31;
/** A departure's post edited by a leader's word on it: above any
 *  revision the roster's own item reaches. */
const CLASSIFIED_REVISION = 1000;
/** A leader's word on a departure edits the departure nearest it, within
 *  this much (its left_at, or the word itself for a removal). */
const DEPARTURE_NEAR_MS = DAY_MS;
/** A member's recent moments told with a rewritten post, and for how
 *  many of a run's members (each is one timeline read before the
 *  model's wait). */
const REWRITE_MOMENTS_MAX = 3;
const REWRITE_MOMENT_MEMBERS = 8;
/** The stories a leader may preview in the clan's voice. */
const PREVIEW_MAX = 5;
/** How far back the channel's history about a member is told. */
const HISTORY_MS = 7 * DAY_MS;
/** The session lock's namespace ("clan"), beside the clan's tag. */
const LOCK_NS = 0x636c616e;

const observedMs = (it) => Date.parse(it.observed_at ?? it.at);
const memberTag = (it) => it.facts?.player_tag ?? null;
const byTime = (a, b) => (a.at ?? "").localeCompare(b.at ?? "");

/** The wake id for a clan: its tag without the #, which S3 keys and
 *  queue logs read plainly. */
export const clanWakeId = (clanTag) => `clan-${String(clanTag).slice(1)}`;

/** A post's content: the story's words escaped for Discord (a name is
 *  shown as typed and never starts a heading or a list), within
 *  Discord's limit. No stamp and no link. */
const postContent = (text) =>
  leadSafe(escapeDiscord(text)).slice(0, DISCORD_CONTENT_MAX);

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
 * What the channel told before about these items, and what it told this
 * week about their members: the memory `buildStories` decides with.
 */
async function storyMemory(db, clanTag, items, now) {
  const { rows: toldRows } = await db.query(
    `select t.item_id, t.revision, t.story_key, t.digest, t.skipped,
            t.skip_reason,
            (select count(*)::int from clan_activity_discord_told s
              where s.clan_tag = t.clan_tag and s.story_key = t.item_id)
              as story_size
       from clan_activity_discord_told t
      where t.clan_tag = $1 and t.item_id = any($2::text[])`,
    [clanTag, items.map((it) => it.id)],
  );
  const told = new Map(toldRows.map((r) => [r.item_id, r]));
  const players = [...new Set(items.map(memberTag).filter(Boolean))];
  const battles = [...new Set(items.map(storyBattleId).filter(Boolean))];
  const battlesTold = new Set();
  const valuesTold = new Set();
  if (players.length) {
    const { rows } = await db.query(
      `select kind, player_tag, battle_id, told_value
         from clan_activity_discord_told
        where clan_tag = $1 and not skipped and player_tag = any($2::text[])
          and (battle_id = any($3::text[])
               or (told_value is not null and item_at > $4))`,
      [clanTag, players, battles, new Date(now - STORY_RETOLD_MS)],
    );
    for (const r of rows) {
      if (r.battle_id) battlesTold.add(`${r.player_tag}|${r.battle_id}`);
      if (r.told_value)
        valuesTold.add(`${r.kind}|${r.player_tag}|${r.told_value}`);
    }
  }
  return { told, battlesTold, valuesTold };
}

/** One told row: what the channel remembers of an item. */
const toldRow = (it, extra) => ({
  item_id: it.id,
  revision: postRevision(it),
  kind: it.kind,
  player_tag: memberTag(it),
  item_at: it.at ?? null,
  story_key: null,
  battle_id: storyBattleId(it),
  told_value: storyValue(it),
  digest: null,
  skipped: false,
  skip_reason: null,
  ...extra,
});

/**
 * The run under the row's lock: the stories to post (each a key, a
 * revision, its items and Elixir's words for it), what is skipped, what
 * is held, what to record as told, and, with the rewrite on, the request
 * for the clan's model. `out` when the run is over before posting
 * anything.
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

  const memory = await storyMemory(db, clanTag, items, now);
  const { told } = memory;
  const fresh = items
    .filter(
      (it) =>
        it.kind !== DEPARTURE_CLASSIFIED &&
        (told.get(it.id)?.revision ?? 0) < postRevision(it),
    )
    .sort(byTime);
  const classified = items
    .filter((it) => it.kind === DEPARTURE_CLASSIFIED && !told.has(it.id))
    .sort(byTime);

  const { stories, skips } = buildStories(fresh, memory);
  // A story is held until it has been quiet a few minutes: the items one
  // moment produces arrive as one post. The pointer stays before it.
  const ready = [];
  const held = [];
  for (const s of stories)
    (storyReady(s, now, observedMs) ? ready : held).push(s);

  // A post: the key and revision it goes under, and the story it tells.
  const posts = ready.map((s) => ({
    key: s.key,
    revision: Math.max(...s.items.map(postRevision)),
    story: s,
  }));
  const toldNow = [];
  for (const s of ready)
    for (const it of s.items)
      toldNow.push(
        toldRow(it, {
          story_key: s.key,
          digest: it.id === s.key ? s.digest : null,
        }),
      );
  for (const k of skips)
    toldNow.push(
      toldRow(k.item, {
        story_key: k.story_key,
        // A story told before that only grew stays told, not skipped.
        skipped: k.reason !== "only_grew",
        skip_reason: k.reason,
      }),
    );

  const heldWords = [];
  for (const c of classified) {
    const tag = memberTag(c);
    // The departure this word is about: the one nearest its left_at (a
    // leader's answer to a departure) or the word itself (a removal,
    // said as it is done), never just the player's latest.
    const target = Date.parse(c.facts?.left_at ?? c.at);
    const departure = (s) =>
      s.items[0].kind === "member_left" && memberTag(s.items[0]) === tag;
    // Its departure is held: so is the word, told with it.
    if (
      tag &&
      nearest(held.filter(departure), target, (s) => Date.parse(s.items[0].at))
    ) {
      heldWords.push(c);
      continue;
    }
    toldNow.push(toldRow(c, { revision: 1, story_key: c.id }));
    if (!tag) continue;
    // Posted in this run: post it once, as the leader told it.
    const here = nearest(
      posts.filter((p) => departure(p.story)),
      target,
      (p) => Date.parse(p.story.items[0].at),
    );
    if (here) {
      here.story = { ...here.story, items: [c] };
      here.revision = CLASSIFIED_REVISION + 1;
      toldNow.find((t) => t.item_id === here.key).revision = here.revision;
      continue;
    }
    // Posted before: edit that post. A row told before 0220 has no
    // time; it is used only when it is the player's one departure.
    const { rows } = await db.query(
      `select item_id, revision, item_at from clan_activity_discord_told
        where clan_tag = $1 and kind = 'member_left' and player_tag = $2
          and not skipped`,
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
    posts.push({
      key: left.item_id,
      revision,
      story: { key: left.item_id, items: [c] },
    });
    toldNow.push({
      ...toldRow(c, {}),
      item_id: left.item_id,
      revision,
      kind: "member_left",
      item_at: left.item_at ? left.item_at.toISOString() : null,
      battle_id: null,
      told_value: null,
    });
  }

  // The pointer never passes a held story: its items are read again.
  const heldFrom = Math.min(
    ...[...held.flatMap((s) => s.items), ...heldWords]
      .map(observedMs)
      .filter(Number.isFinite),
  );
  if (heldFrom <= toMs) toMs = Math.max(fromMs, heldFrom - 1);

  // What the record adds, and Elixir's words for each story.
  const recorded = skips.filter((k) => k.record);
  const rosterTags = posts
    .flatMap((p) => p.story.items)
    .filter(
      (it) =>
        activityCategory(it) === "members" || it.kind === DEPARTURE_CLASSIFIED,
    )
    .map(memberTag);
  const modelOn = Boolean(posts.length && row.rewrite && rewrite);
  const batch = modelOn ? posts.slice(0, REWRITE_BATCH_MAX) : [];
  const tags = [
    ...new Set(
      [
        ...rosterTags,
        ...batch.flatMap((p) => p.story.items.map(memberTag)),
      ].filter(Boolean),
    ),
  ];
  // One pg client: one query at a time (docs/ENGINEERING.md). Moments
  // are one timeline read per member inside the timeline-sync Lambda's
  // budget, before the model's wait: a few, for the first members, and
  // never the items this run is posting.
  const story =
    tags.length || modelOn
      ? await clanStoryFacts(db, clanTag, {
          playerTags: tags,
          nowMs: now,
          // A member's recent moments only while the channel posts
          // milestones: the leaders' switch holds for what the model may
          // tell, too.
          moments: modelOn &&
            categories.milestones === true && {
              max: REWRITE_MOMENTS_MAX,
              members: REWRITE_MOMENT_MEMBERS,
              except: batch.flatMap((p) => [
                p.key,
                ...p.story.items.map((it) => it.id),
              ]),
            },
        })
      : { clan: null, members: {} };
  const context = await storyContext(
    db,
    clanTag,
    posts.map((p) => p.story),
    { nowMs: now },
  );
  const ctxFor = (s) => ({
    ...(context.get(s.key) ?? {}),
    members: story.members,
    nowMs: now,
  });
  for (const p of posts) p.render = renderStory(p.story, ctxFor(p.story));
  const skipped = recorded.map((k) => ({
    key: k.item.id,
    reason: STORY_SKIPS[k.reason] ?? k.reason,
    excerpt: renderStory({ key: k.item.id, items: [k.item] }, ctxFor({})),
  }));

  const plan = {
    row,
    posts,
    skipped,
    held: held.length,
    toldNow,
    toMs,
    narrowed,
    request: null,
  };
  if (!modelOn) return plan;
  const built = await rewritePackets(db, clanTag, row, batch, {
    policy,
    pitchFor,
    now,
    story,
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
 * cached prefix) and one packet per post, with Elixir's own words for
 * its story, its members' records and what the channel already told of
 * them this week.
 */
async function rewritePackets(
  db,
  clanTag,
  row,
  posts,
  { policy = null, pitchFor = null, now = Date.now(), story },
) {
  const tags = [
    ...new Set(
      posts.flatMap((p) => p.story.items.map(memberTag)).filter(Boolean),
    ),
  ];
  const pitch = pitchFor ? await pitchFor(db, clanTag).catch(() => null) : null;
  const history = tags.length
    ? (
        await db.query(
          `select kind, player_tag, count(*)::int as n
             from clan_activity_discord_told
            where clan_tag = $1 and player_tag = any($2::text[])
              and told_at > $3 and not skipped
              and (story_key is null or story_key = item_id)
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
    const items = p.story.items;
    const departing = items.some(
      (it) => it.kind === "member_left" || it.kind === DEPARTURE_CLASSIFIED,
    );
    const people = [...new Set(items.map(memberTag).filter(Boolean))];
    return rewriteLine(
      items.map((it) => ({ ...it, id: p.key })),
      [p.render],
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
          kind: items[0].kind,
          name: story.members[tag]?.name ?? tag,
          // A grown story was told before: itself is not "another".
          count: Math.max(
            0,
            told(items[0].kind, tag) -
              (p.story.grown || p.revision > 1 ? 1 : 0),
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
 * The planned stories written: each in the model's words when they
 * passed the engine's checks, Elixir's otherwise; the skips handed to
 * the relay for the delivery history; everything recorded as told; the
 * pointer moved on; and a wake for the held stories.
 */
async function writeRun(
  db,
  clanTag,
  { outbox, now = Date.now() },
  {
    row,
    posts,
    skipped = [],
    held = 0,
    toldNow,
    toMs,
    narrowed,
    lines = [],
    request = null,
  },
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
  const content = posts.map((p) => ({
    key: p.key,
    revision: p.revision,
    content: postContent(rewrites.get(p.key) ?? p.render),
    ...(rewrites.has(p.key) ? { rewritten: true } : {}),
  }));
  const skips = skipped.map((k) => ({
    key: k.key,
    reason: k.reason,
    ...(k.excerpt ? { excerpt: postContent(k.excerpt) } : {}),
  }));
  const chunks = Math.max(
    Math.ceil(content.length / DISCORD_POSTS_MAX),
    Math.ceil(skips.length / DISCORD_POSTS_MAX),
  );
  for (let i = 0; i < chunks; i += 1) {
    const part = (list) =>
      list.slice(i * DISCORD_POSTS_MAX, (i + 1) * DISCORD_POSTS_MAX);
    await outbox(
      "timeline-discord",
      {
        v: 1,
        kind: "clan_activity",
        account_id: row.channel_id,
        webhook: row.webhook_sealed,
        posts: part(content),
        ...(part(skips).length ? { skipped: part(skips) } : {}),
      },
      { id: `${clanWakeId(clanTag)}.${now}.${i}` },
    );
  }
  if (toldNow.length)
    await db.query(
      `insert into clan_activity_discord_told
              (clan_tag, item_id, revision, kind, player_tag, item_at, told_at,
               story_key, battle_id, told_value, digest, skipped, skip_reason)
       select $1, x.item_id, x.revision, x.kind, x.player_tag, x.item_at, $2,
              x.story_key, x.battle_id, x.told_value, x.digest, x.skipped,
              x.skip_reason
         from unnest($3::text[], $4::int[], $5::text[], $6::text[],
                     $7::timestamptz[], $8::text[], $9::text[], $10::text[],
                     $11::text[], $12::boolean[], $13::text[])
           as x(item_id, revision, kind, player_tag, item_at, story_key,
                battle_id, told_value, digest, skipped, skip_reason)
       on conflict (clan_tag, item_id) do update
          set revision = greatest(clan_activity_discord_told.revision,
                                  excluded.revision),
              item_at = coalesce(excluded.item_at,
                                 clan_activity_discord_told.item_at),
              told_at = excluded.told_at,
              story_key = coalesce(excluded.story_key,
                                   clan_activity_discord_told.story_key),
              battle_id = coalesce(excluded.battle_id,
                                   clan_activity_discord_told.battle_id),
              told_value = coalesce(excluded.told_value,
                                    clan_activity_discord_told.told_value),
              digest = coalesce(excluded.digest,
                                clan_activity_discord_told.digest),
              skipped = clan_activity_discord_told.skipped or excluded.skipped,
              skip_reason = coalesce(
                excluded.skip_reason,
                case when clan_activity_discord_told.skipped
                     then clan_activity_discord_told.skip_reason end)`,
      [
        clanTag,
        new Date(now),
        toldNow.map((t) => t.item_id),
        toldNow.map((t) => t.revision),
        toldNow.map((t) => t.kind),
        toldNow.map((t) => t.player_tag),
        toldNow.map((t) => t.item_at),
        toldNow.map((t) => t.story_key),
        toldNow.map((t) => t.battle_id),
        toldNow.map((t) => t.told_value),
        toldNow.map((t) => t.digest),
        toldNow.map((t) => t.skipped),
        toldNow.map((t) => t.skip_reason),
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
  // A held story is told by a later run: the hold queue brings this
  // clan back in five minutes (one wake a minute, at most).
  if (held)
    await outbox(
      "timeline-hold",
      { v: 1, clan_tag: clanTag },
      { id: `${clanWakeId(clanTag)}.${Math.floor(now / 60_000)}`, once: true },
    );
  return {
    posted: posts.length,
    skips: skipped.length,
    held,
    rewritten: rewrites.size,
    refused,
    rewrite_code: rewriteCode,
    narrowed,
  };
}

/**
 * The clan's last few stories as its model would write them now, for a
 * leader to preview the voice (2026-10-11): the newest `PREVIEW_MAX`
 * stories the channel tells, from the last week, each with Elixir's own
 * words, and the request that rewrites them. Nothing is posted or
 * recorded here; the leader's use of the model is recorded by the model
 * service. `{ empty: true }` when there is nothing to preview.
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
  const { stories } = buildStories([...timeline].sort(byTime));
  const chosen = stories.slice(-PREVIEW_MAX);
  if (!chosen.length) return { empty: true, reason: "nothing_recent" };
  const posts = chosen.map((s) => ({
    key: s.key,
    revision: Math.max(...s.items.map(postRevision)),
    story: s,
  }));
  const tags = [
    ...new Set(chosen.flatMap((s) => s.items.map(memberTag)).filter(Boolean)),
  ];
  // Told what a real post is told.
  const story = await clanStoryFacts(db, clanTag, {
    playerTags: tags,
    nowMs: now,
    moments: categories.milestones === true && {
      max: REWRITE_MOMENTS_MAX,
      members: REWRITE_MOMENT_MEMBERS,
      except: posts.flatMap((p) => [
        p.key,
        ...p.story.items.map((it) => it.id),
      ]),
    },
  });
  const context = await storyContext(db, clanTag, chosen, { nowMs: now });
  for (const p of posts)
    p.render = renderStory(p.story, {
      ...(context.get(p.key) ?? {}),
      members: story.members,
      nowMs: now,
    });
  const built = await rewritePackets(
    db,
    clanTag,
    // The voice being written in the page, when the leader is trying one.
    voice === undefined ? row : { ...row, voice },
    posts,
    { policy, pitchFor, now, story },
  );
  return {
    empty: false,
    lines: built.lines,
    posts: posts.map((p) => ({
      key: p.key,
      kind: p.story.items[0].kind,
      at: p.story.items[0].at,
      elixir: p.render,
    })),
    request: activityRewriteRequest({
      context: built.context,
      lines: built.lines,
    }),
  };
}
