/**
 * A subject's stories, stored (timeline_story, 0314; stage 1 of the
 * stored Timeline, 2026-11-23). The timeline is built per reader on every
 * read outside Home; the direction is to store each subject's stories as
 * the record learns them, so a read is one select and a viewer layer
 * (docs/notes/2026-11-23-timeline-story-store.md).
 *
 * The builder is the only author: writeSubjectStories calls buildTimeline
 * for one subject with no viewer (no account, no nickname, UTC) and
 * stores what it tells, less what a reader adds (FINISHED below). Nothing
 * here decides what a story says.
 *
 * Players only. A clan's timeline depends on its reader: the account's
 * scope (comprehensive or activity) chooses what buildClanEntry reads,
 * and its standouts count only a crossing learned inside the window. So
 * clan rows wait for the stage that settles both.
 *
 * Stage 1 writes from {timeline_story_backfill} and compares on the
 * player page (compareStories). Stage 2 (2026-11-23) keeps the rows
 * fresh: an admission that wrote facts about a recorded player wakes the
 * timeline-sync lane (story-wake.mjs), whose run calls
 * refreshSubjectStories; the jobs' five-minute home_feeds run wakes what
 * no admission announces (storiesToWake). Each write stamps
 * timeline_story_subject (0315) with when its build began
 * (docs/notes/2026-11-23-timeline-story-fresh.md). Stage 3 (2026-11-24)
 * stores every recorded player (RECORDED_PLAYERS_SQL, the tools' own
 * set) and serves the rows to the player page, its games' read and its
 * session read when readSubjectStories proves them current
 * (docs/notes/2026-11-24-timeline-story-read.md).
 */
import { createHash } from "node:crypto";
import {
  ITEM_KINDS,
  buildTimeline,
  itemVisibility,
  restoredItem,
  saidStories,
  storedItem,
  timelineNews,
} from "./entries.mjs";
import { RECORDED_PLAYERS_SQL } from "../recorded-players.mjs";

const DAY_MS = 86_400_000;

/** How far back stories are kept, and what a write with no span covers:
 *  a session link's 30 days (the longest a player-page read reaches,
 *  through the same stored read; its list reads the Timeline's week,
 *  lookback.mjs) and a margin. */
export const STORY_SPAN_DAYS = 35;

/** Items the store never holds. A Drop game is a signed-in follower's
 *  alone (pageGameReader); a post about a battle is the post's, edited
 *  and removed in its own table and read live. */
export const UNSTORED_KINDS = new Set(["drop_game", "battle_highlight"]);

/** Nor a people item (a player's verification): it tells an account's
 *  claim, which its owner can remove, and its account's identity, which
 *  can be deleted. A stored copy would say so for hours after; a read adds
 *  it live (storedTimeline's `people`). */
export const unstored = (it) =>
  UNSTORED_KINDS.has(it.kind) || it.section === "people";

/** What finishItem writes for a reader (its zone, its window, its door),
 *  and the reader's own nickname: never stored. */
const FINISHED = [
  "text",
  "local",
  "at_unix",
  "late",
  "visibility",
  "publishable",
  "schema",
  "nickname",
];

/** JSON with every object's keys sorted, so equal items hash equal. */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(",")}}`;
  return JSON.stringify(v ?? null);
}

/** An item as the store keeps it: its server-only fields as plain keys
 *  (storedItem), no reader's fields, and its hash. Takes a finished item
 *  or one a cap left out; both store the same. */
export function storyForm(it) {
  const stored = JSON.parse(JSON.stringify(storedItem(it)));
  for (const k of FINISHED) delete stored[k];
  stored.sort_at ??= stored.at;
  return {
    item: stored,
    content_hash: createHash("sha256").update(canonical(stored)).digest("hex"),
  };
}

/** The kinds a stored row can be: what timelineNews is asked about when
 *  the sweep and the staleness op look for news since a write. */
export const STORED_KINDS = ITEM_KINDS.filter((k) => !UNSTORED_KINDS.has(k));

/** The span a write with none covers: STORY_SPAN_DAYS to `now`. */
export const storySpan = (now = Date.now()) => ({
  fromMs: now - STORY_SPAN_DAYS * DAY_MS,
  toMs: now,
});

/** The stories the builder tells about one player over the span, as rows:
 *  the player page's read (occurred, the public game record), with no
 *  reader, no people items (`unstored`) and no cap. */
export async function buildSubjectStories(db, kind, tag, span = storySpan()) {
  if (kind !== "player")
    throw new Error(`timeline_story stores players only, not ${kind}`);
  const built = await buildTimeline(
    db,
    [{ kind: "player", tag, relationship: null, nickname: null }],
    {
      fromMs: span.fromMs,
      toMs: span.toMs,
      timezone: "UTC",
      accountId: null,
      basis: "occurred",
      lateCounts: false,
      cap: Number.MAX_SAFE_INTEGER,
    },
  );
  return built.timeline
    .filter((it) => !unstored(it))
    .map((it) => {
      const { item, content_hash } = storyForm(it);
      return {
        story_id: it.id,
        kind: it.kind,
        section: it.section,
        revision: it.revision ?? 1,
        at: item.at,
        sort_at: item.sort_at,
        observed_at: item.observed_at ?? item.at,
        visibility: itemVisibility(it),
        content_hash,
        item,
      };
    });
}

/**
 * Builds one subject's stories over `span` ({fromMs, toMs}; the last
 * STORY_SPAN_DAYS when omitted) and stores them: a row is written when
 * it is new or its revision or content hash moved, and a stored row whose
 * sort_at lies inside the span that the build no longer tells is
 * deleted. Rows outside the span are left alone. Safe to run again: a
 * second run over the same record writes nothing.
 *
 * The subject's timeline_story_subject row (0315) records when the build
 * began. Two writes of one subject take turns (a transaction-scoped
 * advisory lock), and a build that began before the committed one
 * commits nothing: an older build never overwrites a newer one.
 *
 * Returns counts: `{ stories, written, deleted }`, and `superseded: true`
 * when a newer write was already in.
 */
export async function writeSubjectStories(db, kind, tag, span = storySpan()) {
  const started = Date.now();
  const rows = await buildSubjectStories(db, kind, tag, span);
  await db.query("begin");
  try {
    await db.query("select pg_advisory_xact_lock(hashtext($1))", [
      `timeline_story:${kind}:${tag}`,
    ]);
    const {
      rows: [marker],
    } = await db.query(
      `select written_at from timeline_story_subject
        where subject_kind = $1 and subject_tag = $2`,
      [kind, tag],
    );
    if (marker && new Date(marker.written_at).getTime() > started) {
      await db.query("rollback");
      return { stories: rows.length, written: 0, deleted: 0, superseded: true };
    }
    const written = rows.length
      ? (
          await db.query(
            `insert into timeline_story
               (subject_kind, subject_tag, story_id, kind, section, revision,
                at, sort_at, observed_at, visibility, content_hash, item)
             select $1, $2, r.story_id, r.kind, r.section, r.revision,
                    r.at, r.sort_at, r.observed_at, r.visibility,
                    r.content_hash, r.item
               from jsonb_to_recordset($3::jsonb) as r(
                 story_id text, kind text, section text, revision integer,
                 at timestamptz, sort_at timestamptz, observed_at timestamptz,
                 visibility text, content_hash text, item jsonb)
             on conflict (subject_kind, subject_tag, story_id) do update
               set kind = excluded.kind,
                   section = excluded.section,
                   revision = excluded.revision,
                   at = excluded.at,
                   sort_at = excluded.sort_at,
                   observed_at = excluded.observed_at,
                   visibility = excluded.visibility,
                   content_hash = excluded.content_hash,
                   built_at = now(),
                   item = excluded.item
             where (timeline_story.revision, timeline_story.content_hash)
                   is distinct from (excluded.revision, excluded.content_hash)`,
            [kind, tag, JSON.stringify(rows)],
          )
        ).rowCount
      : 0;
    const { rowCount: deleted } = await db.query(
      `delete from timeline_story
        where subject_kind = $1 and subject_tag = $2
          and sort_at > $3 and sort_at <= $4
          and story_id <> all($5::text[])`,
      [
        kind,
        tag,
        new Date(span.fromMs).toISOString(),
        new Date(span.toMs).toISOString(),
        rows.map((r) => r.story_id),
      ],
    );
    await db.query(
      `insert into timeline_story_subject
         (subject_kind, subject_tag, written_at, stories, build_ms)
       values ($1, $2, $3, $4, $5)
       on conflict (subject_kind, subject_tag) do update
         set written_at = excluded.written_at,
             stories = excluded.stories,
             build_ms = excluded.build_ms`,
      [
        kind,
        tag,
        new Date(started).toISOString(),
        rows.length,
        Date.now() - started,
      ],
    );
    await db.query("commit");
    return { stories: rows.length, written, deleted };
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }
}

/** When the subject's stories were last written (0315), as epoch ms, or
 *  null when stage 2 has never written them. */
export async function writtenAt(db, kind, tag) {
  const {
    rows: [m],
  } = await db.query(
    `select written_at from timeline_story_subject
      where subject_kind = $1 and subject_tag = $2`,
    [kind, tag],
  );
  return m ? new Date(m.written_at).getTime() : null;
}

/**
 * A wake's write (the timeline-sync lane, stage 2): `since` is when the
 * wake was written (ISO), after whatever it announces was committed. A
 * write whose build began at or after it already holds that, so the wake
 * is served without a build: several wakes for one player collapse into
 * the first write that runs after them. Returns writeSubjectStories'
 * counts, or `{ skipped: "fresh" }`.
 */
export async function refreshSubjectStories(
  db,
  kind,
  tag,
  { since = null, span = undefined } = {},
) {
  const sinceMs = since === null ? NaN : Date.parse(since);
  if (Number.isFinite(sinceMs)) {
    const at = await writtenAt(db, kind, tag);
    if (at !== null && at >= sinceMs) return { skipped: "fresh" };
  }
  return writeSubjectStories(db, kind, tag, span ?? storySpan());
}

/** Has the record learned anything the stored stories can tell since
 *  `sinceMs`? timelineNews, the sync's own probe, over the stored kinds:
 *  battles learned, ledger rows observed, clan moves, war weeks, a week's
 *  form, attested facts, and a quiet rung crossed by the clock. */
export async function subjectNews(db, tag, sinceMs, nowMs = Date.now()) {
  if (sinceMs >= nowMs) return false;
  const { any } = await timelineNews(db, [{ kind: "player", tag }], {
    fromMs: sinceMs,
    toMs: nowMs,
    kinds: STORED_KINDS,
  });
  return any;
}

/** A sitting is closed once its last battle is SESSION_GAP_MS (30 min)
 *  old; a minute more for the read. */
const SITTING_QUIET_MS = 31 * 60_000;
/** A player's rows are rewritten at least this often, whatever the
 *  record says: the repair for what no probe sees (a profile's own
 *  change whose wake was lost, days_since_poll) and the window's slide. */
export const STORY_FLOOR_MS = 6 * 3_600_000;
/** Wakes one sweep writes at most, and the time its news probes take. */
export const SWEEP_WAKES = 25;
const SWEEP_BUDGET_MS = 20_000;
/** A player written this recently is not probed for news. */
const JUST_WRITTEN_MS = 2 * 60_000;

/** How old a write the read still serves: the floor, and a margin for a
 *  sweep that runs late. Older, the subject left the set or the sweep is
 *  not running, and the read computes. */
export const STORY_READ_MARGIN_MS = 30 * 60_000;
const STORY_READ_STALE_MS = STORY_FLOOR_MS + STORY_READ_MARGIN_MS;

/**
 * One subject's stored stories for a read (stage 3 of the stored
 * Timeline, 2026-11-24; docs/notes/2026-11-24-timeline-story-read.md),
 * served only when they are provably current. Answers
 * `{ ok: true, items, written_at }`, the rows whose sort_at lies in
 * (fromMs, toMs] and whose visibility is one of `visibilities`, each as
 * the builder finished it (restoredItem: its server-only fields back
 * under their symbols), newest first; or `{ ok: false, reason }`:
 *
 *  - `unwritten`: no timeline_story_subject marker (a player outside the
 *    stored set, or never written).
 *  - `stale`: the marker is older than the floor and STORY_READ_MARGIN_MS.
 *  - `news`: the record learned something the stored kinds can tell
 *    since the write (subjectNews), so a read right after a live fetch or
 *    an admission computes rather than serve rows a minute behind.
 *  - `open`: a stored sitting in the window says `open` and its last
 *    battle is more than SITTING_QUIET_MS old: the clock closed it and no
 *    write has yet.
 *
 * The stored telling is canonical: rows are taken by sort_at as the
 * 35-day build told them, never re-cut to the read's window. A stored
 * quiet_crossed item's `days_since_poll` is the write's (at most the
 * floor old, in whole days) and is served as stored, with no read-time
 * recompute. A people item is never served from a row (`unstored`; a row
 * written before 2026-11-24 can still hold one until its next write).
 * Players only. Three statements, one at a time: the marker, the probe
 * (subjectNews) and the select.
 */
export async function readSubjectStories(
  db,
  kind,
  tag,
  { fromMs, toMs, visibilities, now = Date.now() },
) {
  if (kind !== "player")
    throw new Error(`timeline_story serves players only, not ${kind}`);
  const writtenMs = await writtenAt(db, kind, tag);
  if (writtenMs === null) return { ok: false, reason: "unwritten" };
  if (now - writtenMs > STORY_READ_STALE_MS)
    return { ok: false, reason: "stale" };
  if (await subjectNews(db, tag, writtenMs, now))
    return { ok: false, reason: "news" };
  const { rows } = await db.query(
    `select item from timeline_story
      where subject_kind = $1 and subject_tag = $2
        and sort_at > $3 and sort_at <= $4
        and visibility = any($5::text[])
        and section <> 'people'
      order by sort_at desc, story_id`,
    [
      kind,
      tag,
      new Date(fromMs).toISOString(),
      new Date(toMs).toISOString(),
      visibilities,
    ],
  );
  for (const { item } of rows)
    if (
      item.kind === "battle_session" &&
      item.facts?.open === true &&
      now - Date.parse(item.facts.ended_at ?? item.sort_at) > SITTING_QUIET_MS
    )
      return { ok: false, reason: "open" };
  return {
    ok: true,
    items: rows.map((r) => restoredItem(r.item)),
    written_at: new Date(writtenMs).toISOString(),
  };
}

/** Every recorded player (RECORDED_PLAYERS_SQL: a direct recording, or
 *  an open member of a clan recorded at comprehensive scope) with their
 *  write's time (null: never written by stage 2) and whether a sitting
 *  stored open has since gone quiet. A player who leaves the set keeps
 *  their rows until the daily trim. */
const RECORDED_PLAYERS = `
  select r.tag, m.written_at,
         exists (select 1 from timeline_story s
                  where s.subject_kind = 'player' and s.subject_tag = r.tag
                    and s.kind = 'battle_session'
                    and s.sort_at > $1 and s.sort_at < $2
                    and s.item->'facts'->>'open' = 'true') as open_quiet
    from (select player_tag as tag from (${RECORDED_PLAYERS_SQL}) rp) r
    left join timeline_story_subject m
      on m.subject_kind = 'player' and m.subject_tag = r.tag
   order by m.written_at nulls first, md5(r.tag)`;

async function recordedPlayers(db, now) {
  const { rows } = await db.query(RECORDED_PLAYERS, [
    new Date(now - STORY_SPAN_DAYS * DAY_MS).toISOString(),
    new Date(now - SITTING_QUIET_MS).toISOString(),
  ]);
  return rows.map((r) => ({
    tag: r.tag,
    writtenMs: r.written_at ? new Date(r.written_at).getTime() : null,
    openQuiet: r.open_quiet === true,
  }));
}

/**
 * The players whose stored stories the jobs' five-minute run wakes, at
 * most `limit`, by reason: `open` (a sitting stored open whose player has
 * since gone quiet: the clock closes it, no admission does), `unwritten`
 * (recorded, never written by stage 2), `news` (the record learned
 * something since the write that no admission announced: another player's
 * log carrying their battle, a clan read's move, a war week, a rung the
 * clock crossed, or a write that failed), `floor` (not written for
 * STORY_FLOOR_MS). News is probed one player at a time, oldest write
 * first, within SWEEP_BUDGET_MS.
 *
 * Returns `{ tags, counts }`; the counts carry no tag.
 */
export async function storiesToWake(
  db,
  { now = Date.now(), limit = SWEEP_WAKES, budgetMs = SWEEP_BUDGET_MS } = {},
) {
  const started = Date.now();
  const players = await recordedPlayers(db, now);
  const counts = {
    recorded: players.length,
    open: 0,
    unwritten: 0,
    news: 0,
    floor: 0,
    probed: 0,
  };
  const tags = [];
  const take = (p, reason) => {
    if (tags.length >= limit) return false;
    tags.push(p.tag);
    counts[reason] += 1;
    p.taken = true;
    return true;
  };
  for (const p of players) if (p.openQuiet) take(p, "open");
  for (const p of players)
    if (!p.taken && p.writtenMs === null) take(p, "unwritten");
  for (const p of players) {
    if (tags.length >= limit || Date.now() - started >= budgetMs) break;
    if (p.taken || p.writtenMs === null) continue;
    if (p.writtenMs > now - JUST_WRITTEN_MS) continue;
    counts.probed += 1;
    if (await subjectNews(db, p.tag, p.writtenMs, now)) take(p, "news");
  }
  for (const p of players)
    if (!p.taken && p.writtenMs !== null && p.writtenMs < now - STORY_FLOOR_MS)
      take(p, "floor");
  return { tags, counts };
}

/**
 * How fresh the store is, in counts only ({timeline_story_staleness}):
 * players recorded, players with rows, players stage 2 has written,
 * players whose record learned something after their write (subjectNews),
 * the longest such a player has gone since its write, sittings stored
 * open that have gone quiet, and the last writes' build time (average and
 * most, in ms). Reads only; the news probes stop at
 * `budgetMs`, and `probed` says how many ran.
 */
export async function storyStaleness(
  db,
  { now = Date.now(), budgetMs = 45_000 } = {},
) {
  const started = Date.now();
  const players = await recordedPlayers(db, now);
  const {
    rows: [withRows],
  } = await db.query(
    `select count(distinct s.subject_tag)::int as n
       from timeline_story s
      where s.subject_kind = 'player'
        and s.subject_tag in (select player_tag from (${RECORDED_PLAYERS_SQL}) rp)`,
  );
  const {
    rows: [build],
  } = await db.query(
    `select round(avg(build_ms))::int as avg_ms, max(build_ms)::int as max_ms
       from timeline_story_subject
      where subject_kind = 'player'`,
  );
  const out = {
    players_recorded: players.length,
    players_with_rows: withRows.n,
    players_written: 0,
    players_unwritten: 0,
    players_stale: 0,
    oldest_gap_s: null,
    oldest_write_s: null,
    open_quiet: 0,
    build_ms_avg: build.avg_ms,
    build_ms_max: build.max_ms,
    probed: 0,
    complete: true,
    ms: 0,
  };
  for (const p of players) {
    if (p.openQuiet) out.open_quiet += 1;
    if (p.writtenMs === null) {
      out.players_unwritten += 1;
      continue;
    }
    out.players_written += 1;
    const age = Math.round((now - p.writtenMs) / 1000);
    out.oldest_write_s = Math.max(out.oldest_write_s ?? 0, age);
  }
  // Oldest write first, so a probe cut short has looked at the worst.
  for (const p of players) {
    if (p.writtenMs === null) continue;
    if (Date.now() - started >= budgetMs) {
      out.complete = false;
      break;
    }
    out.probed += 1;
    if (await subjectNews(db, p.tag, p.writtenMs, now)) {
      out.players_stale += 1;
      const gap = Math.round((now - p.writtenMs) / 1000);
      out.oldest_gap_s = Math.max(out.oldest_gap_s ?? 0, gap);
    }
  }
  out.ms = Date.now() - started;
  return out;
}

const SAMPLE = 5;
/** Content differences whose stored item is read to name the fields. */
const FIELD_SAMPLE = 10;
/** Groups one comparison reports at most. */
const GROUPS = 25;
/** A story this close to the window's start can differ by the window
 *  alone (a sitting begun before it is cut by the wider fetch, repeats
 *  collapse and first ids are found inside the window, an occurred
 *  ledger row must be observed after `from`, a return at the window's
 *  first battle whose earlier battles a wider window holds). Since stage
 *  3 a return is told at every battle after a gap (presenceOf), so it is
 *  `window` only here, like any other kind. */
const WINDOW_EDGE_MS = 2 * DAY_MS;
/** Objects whose own keys are fixed field names, so a difference is
 *  named one level down; every other key is named at the top. */
const NAMED_DEEP = new Set(["facts", "evidence"]);
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The fields in which a computed and a stored item differ: top-level
 *  keys, and `facts.<k>` or `evidence.<k>` inside those two. Names only,
 *  never a value. */
export function changedFields(computed, stored) {
  const out = new Set();
  const a = computed ?? {};
  const b = stored ?? {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (canonical(a[k]) === canonical(b[k])) continue;
    const x = a[k];
    const y = b[k];
    const deep =
      NAMED_DEEP.has(k) &&
      [x, y].every((v) => v && typeof v === "object" && !Array.isArray(v));
    if (!deep) {
      out.add(FIELD_NAME.test(k) ? k : "*");
      continue;
    }
    for (const j of new Set([...Object.keys(x), ...Object.keys(y)]))
      if (canonical(x[j]) !== canonical(y[j]))
        out.add(`${k}.${FIELD_NAME.test(j) ? j : "*"}`);
  }
  return [...out].sort();
}

const ms = (v) => (v ? new Date(v).getTime() : null);

/**
 * The stored rows for one subject and window beside a computed timeline,
 * as counts and at most SAMPLE story ids of each kind of difference;
 * never an item's contents. `items` are the computed items (finished or
 * cut by the cap), already filtered as the reader's door filters;
 * `visibilities` the same filter for the rows. A stored row is in the
 * window when its sort_at is, as an occurred read selects.
 *
 * Stage 2 adds what decides stage 3: `written_at` (the subject's last
 * write, 0315), `newest_learned_at` (the newest computed story's
 * observed_at: the newest thing the record knows for the window), `stale`
 * (the record knows something the last write did not), `lag_s` (seconds
 * since the write), and `groups`: each difference counted by story kind,
 * bucket (only_computed, only_stored, revision, content), cause and, for
 * content, the field that differs. The cause is `unwritten` (no write
 * yet, or the story was learned after it), `window` (a story within
 * WINDOW_EDGE_MS of the window's start) or `settled`
 * (neither: what stage 3 must explain). Field names are read from at most
 * FIELD_SAMPLE stored items; past that the field is `unread`.
 */
export async function compareStories(
  db,
  kind,
  tag,
  items,
  { fromMs, toMs, visibilities, now = Date.now() },
) {
  // The window's rows as a read serves them: no people item (`unstored`),
  // and no quiet crossing the window's build would drop (saidStories).
  const { rows: held } = await db.query(
    `select story_id, kind, section, revision, content_hash, at, sort_at,
            observed_at, max(built_at) over () as newest_built_at
       from timeline_story
      where subject_kind = $1 and subject_tag = $2
        and sort_at > $3 and sort_at <= $4
        and visibility = any($5::text[])
        and section <> 'people'`,
    [
      kind,
      tag,
      new Date(fromMs).toISOString(),
      new Date(toMs).toISOString(),
      visibilities,
    ],
  );
  const rows = saidStories(held);
  const writtenMs = await writtenAt(db, kind, tag);
  const stored = new Map(rows.map((r) => [r.story_id, r]));
  const out = {
    computed: 0,
    stored: rows.length,
    only_computed: 0,
    only_stored: 0,
    revision: 0,
    content: 0,
    ids: { only_computed: [], only_stored: [], revision: [], content: [] },
    newest_built_at: held[0]?.newest_built_at
      ? new Date(held[0].newest_built_at).toISOString()
      : null,
    written_at: writtenMs === null ? null : new Date(writtenMs).toISOString(),
    lag_s: writtenMs === null ? null : Math.round((now - writtenMs) / 1000),
    newest_learned_at: null,
    stale: false,
    groups: [],
  };
  const counted = new Map();
  const count = (storyKind, bucket, cause, field = null) => {
    const key = `${storyKind}\u0000${bucket}\u0000${cause}\u0000${field}`;
    const g = counted.get(key) ?? {
      kind: storyKind,
      bucket,
      cause,
      field,
      n: 0,
    };
    g.n += 1;
    counted.set(key, g);
  };
  const near = (atMs, sortMs) =>
    Math.min(atMs ?? Infinity, sortMs ?? Infinity) <= fromMs + WINDOW_EDGE_MS;
  const causeOf = (learnedMs, atMs, sortMs) => {
    if (writtenMs === null || (learnedMs ?? 0) > writtenMs) return "unwritten";
    if (near(atMs, sortMs)) return "window";
    return "settled";
  };
  const note = (bucket, id) => {
    out[bucket] += 1;
    if (out.ids[bucket].length < SAMPLE) out.ids[bucket].push(id);
  };
  let newestLearned = null;
  const contentDiffs = [];
  const seen = new Set();
  for (const it of items) {
    if (unstored(it) || seen.has(it.id)) continue;
    seen.add(it.id);
    out.computed += 1;
    const learnedMs = ms(it.observed_at ?? it.at);
    if (
      learnedMs !== null &&
      (newestLearned === null || learnedMs > newestLearned)
    )
      newestLearned = learnedMs;
    const cause = causeOf(learnedMs, ms(it.at), ms(it.sort_at ?? it.at));
    const row = stored.get(it.id);
    if (!row) {
      note("only_computed", it.id);
      count(it.kind, "only_computed", cause);
    } else if (row.revision !== (it.revision ?? 1)) {
      note("revision", it.id);
      count(it.kind, "revision", cause);
    } else {
      const form = storyForm(it);
      if (row.content_hash !== form.content_hash) {
        note("content", it.id);
        contentDiffs.push({ id: it.id, kind: it.kind, cause, item: form.item });
      }
    }
  }
  out.newest_learned_at =
    newestLearned === null ? null : new Date(newestLearned).toISOString();
  out.stale =
    newestLearned !== null && (writtenMs === null || newestLearned > writtenMs);
  for (const [id, row] of stored) {
    if (seen.has(id)) continue;
    note("only_stored", id);
    // A row the build no longer tells: the window's, or one a write
    // since the record moved would take back.
    const cause =
      writtenMs === null
        ? "unwritten"
        : near(ms(row.at), ms(row.sort_at))
          ? "window"
          : out.stale
            ? "unwritten"
            : "settled";
    count(row.kind, "only_stored", cause);
  }
  if (contentDiffs.length) {
    const read = contentDiffs.slice(0, FIELD_SAMPLE);
    const { rows: items } = await db.query(
      `select story_id, item from timeline_story
        where subject_kind = $1 and subject_tag = $2
          and story_id = any($3::text[])`,
      [kind, tag, read.map((d) => d.id)],
    );
    const byId = new Map(items.map((r) => [r.story_id, r.item]));
    for (const [i, d] of contentDiffs.entries()) {
      const fields =
        i < FIELD_SAMPLE && byId.has(d.id)
          ? changedFields(d.item, byId.get(d.id))
          : ["unread"];
      for (const f of fields.length ? fields : ["unread"])
        count(d.kind, "content", d.cause, f);
    }
  }
  out.groups = [...counted.values()]
    .sort(
      (x, y) =>
        y.n - x.n ||
        `${x.kind}${x.bucket}${x.cause}${x.field}`.localeCompare(
          `${y.kind}${y.bucket}${y.cause}${y.field}`,
        ),
    )
    .slice(0, GROUPS);
  out.groups_cut = Math.max(0, counted.size - GROUPS);
  return out;
}
