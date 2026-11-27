/**
 * Home's week, stored (home_feed, 0245; #649, 2026-11-12). The timeline
 * builder reads seven days of every followed player and clan, and on the
 * database's instance that read is cold I/O: 12 s for the heaviest
 * account, never Home's 2 s. So the week is built in the background and
 * stored per account, and Home reads the row
 * (docs/notes/2026-11-12-home-feed-stored.md).
 *
 * - The timeline-sync Lambda builds it when a wake names the account: the
 *   jobs' five-minute run wakes every account that read Home in the last
 *   three days and whose row is past FRESH, and every account that read
 *   Home in the last seven days whose row is past HOME_IDLE_REBUILD_MS
 *   (under SERVE, so a week away still opens on a stored row); a read that
 *   finds its row past FRESH wakes it too. The same build makes a missing
 *   bell row.
 * - A read builds it itself, as before, when there is no row, the
 *   account's subjects or time zone changed since it was built, or it is
 *   past SERVE.
 * - One build per account at a time (buildOnce): a second reader or wake
 *   waits for the first build and reads its row.
 * - Highlights and attested facts are read live over the stored items (a
 *   post shows at once; who may see a fact is decided at the read), and
 *   cheers, counts and the seen marker stay the read's own.
 *
 * Nothing here changes what an item says or who may see it: the items are
 * the builder's, for the same reader, at most SERVE old.
 */
import { createHash } from "node:crypto";
import {
  buildTimeline,
  clanStoriesFor,
  followedAccountIds,
  restoredItem,
  shownAt,
  storedItem,
  subjectsFor,
  windowFacts,
  windowHighlights,
} from "./entries.mjs";
import { TIMELINE_LOOKBACK_MS } from "./lookback.mjs";
import {
  changedFields,
  finishedHash,
  plainItem,
  readClansStories,
  readPlayersStories,
} from "./story-store.mjs";

/** The week Home shows: the Timeline's one look-back (lookback.mjs). */
export const HOME_WEEK_MS = TIMELINE_LOOKBACK_MS;
/** A row younger than this is served without a wake. */
export const HOME_FRESH_MS = 15 * 60_000;
/** A row older than this is not served: the read builds. */
export const HOME_SERVE_MS = 3 * 3_600_000;
/** Accounts the five-minute wake keeps fresh: read Home this recently. */
export const HOME_READ_RECENT_MS = 3 * 86_400_000;
/** Accounts away longer, up to a week, are kept under SERVE instead: their
 *  week is rebuilt once it is this old, so a return within a week never
 *  waits for a build (round four, #649). */
export const HOME_READ_IDLE_MS = 7 * 86_400_000;
export const HOME_IDLE_REBUILD_MS = 2 * 3_600_000;
/** How long a read waits for another build of the same account's row to
 *  finish before its last attempt to reuse a valid stored row. */
const BUILD_WAIT_MS = 12_000;
/** read_at moves at most this often (one write an hour, not a read). */
const READ_MARK_MS = 3_600_000;
/** Wakes per five-minute run, oldest row first: the lane runs two at a
 *  time and the heaviest build is about 12 s. */
const WAKES_PER_RUN = 10;

/** The subjects a week was built for, as one digest: a follow, an unfollow,
 *  a notify switch or a nickname changes it, and the read rebuilds. */
export function subjectsKey(subjects) {
  const rows = subjects
    .map((s) =>
      JSON.stringify([
        s.kind,
        s.tag,
        s.relationship ?? null,
        s.scope ?? null,
        s.nickname ?? null,
      ]),
    )
    .sort();
  return createHash("sha256")
    .update(rows.join("\n"))
    .digest("hex")
    .slice(0, 32);
}

/** Home's key: its subjects and the accounts it follows (0277). */
const homeKey = (subjects, accounts = []) =>
  subjectsKey([
    ...subjects,
    ...accounts.map((id) => ({ kind: "account", tag: id })),
  ]);

/**
 * One build of an account's stored row at a time. Two cold reads of one
 * account (two panels, two tabs, a read and the background lane) used to
 * build the same row side by side, each holding a pool client and the
 * database for seconds. `build` runs under a session advisory lock keyed
 * by `name` and the account; a second caller waits for it (at most
 * BUILD_WAIT_MS). Callers have already checked the row. A caller that
 * waited checks again under the lock before starting a replacement build.
 */
export async function buildOnce(
  db,
  name,
  accountId,
  { build, reuse, waitMs = BUILD_WAIT_MS },
) {
  const key = [name, String(accountId)];
  const until = Date.now() + waitMs;
  let waited = false;
  for (let pause = 100; ; pause = Math.min(pause * 2, 800)) {
    const { rows } = await db.query(
      `select pg_try_advisory_lock(hashtext($1), hashtext($2)) as ok`,
      key,
    );
    if (rows[0].ok) {
      try {
        if (waited) {
          const kept = await reuse();
          if (kept != null) return kept;
        }
        return await build();
      } finally {
        await db.query(
          `select pg_advisory_unlock(hashtext($1), hashtext($2))`,
          key,
        );
      }
    }
    waited = true;
    const remaining = until - Date.now();
    if (remaining <= 0) {
      // The builder can commit its row before it releases the lock.
      const kept = await reuse();
      if (kept != null) return kept;
      throw Object.assign(new Error("Cache build is still running"), {
        code: "cache_build_busy",
      });
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(pause, remaining)),
    );
  }
}

/** The account's time zone and seen marker, as the feed reads them. */
export async function homeAccount(db, accountId) {
  const { rows } = await db.query(
    `select console_timeline_seen_at, timezone from account
      where account_id = $1`,
    [accountId],
  );
  return {
    timezone: rows[0]?.timezone ?? "UTC",
    seenTo: rows[0]?.console_timeline_seen_at?.toISOString() ?? null,
  };
}

/**
 * Build the account's week ending `now` and store it. Home's week leaves
 * the account's own administration out (the bell tells it). Returns the
 * week as a read serves it: finished items, newest first, with their
 * server-only fields.
 */
export async function buildHomeWeek(
  db,
  accountId,
  {
    subjects,
    accounts = [],
    timezone,
    now = Date.now(),
    readAt = null,
    perf = null,
    // Stage 4 of the stored Timeline (TIMELINE_STORY_BUILD, storyBuildOf):
    // `off` builds every player, `shadow` stores that and then builds again
    // with followed players from their stored rows and compares the two,
    // `on` stores the second build.
    storyBuild = "off",
    // Stage 6 (TIMELINE_STORY_BUILD_CLANS, storyClansBuildOf), only while
    // storyBuild is `on` (else `off`): `off` builds every clan, `shadow`
    // stores that and then builds again with followed clans from their
    // stored rows too and compares the two, `on` stores the second build.
    storyClans = "off",
    // The wall clock the stored rows are judged against (tests pin it).
    storyNow = Date.now(),
  },
) {
  const fromMs = now - HOME_WEEK_MS;
  const options = {
    fromMs,
    toMs: now,
    timezone,
    accountId,
    interactive: true,
    accountLines: false,
    // Items only (Home stores and serves no entry), so no late count to
    // read, as the bell's week and cheers.
    lateCounts: false,
    // The account-level news of the accounts you follow and of the
    // players you follow: a verified player, a Stamp, a place (0277).
    people: { accounts, players: true },
    perf,
  };
  const clansMode = storyBuild === "on" ? storyClans : "off";
  const storedPlayers = { read: readPlayersStories, now: storyNow };
  const storedClans = { read: readClansStories, now: storyNow };
  const mixed = () =>
    buildTimeline(db, subjects, { ...options, storedPlayers });
  // Followed players and clans both from their rows (stage 6).
  const allStored = () =>
    buildTimeline(db, subjects, { ...options, storedPlayers, storedClans });
  const started = Date.now();
  const built = await (storyBuild !== "on"
    ? buildTimeline(db, subjects, options)
    : clansMode === "on"
      ? allStored()
      : clansMode === "shadow"
        ? // Which ids each built clan told: the shadow's attribution.
          buildTimeline(db, subjects, {
            ...options,
            storedPlayers,
            clanTold: true,
          })
        : mixed());
  const buildMs = Date.now() - started;
  const items = built.timeline ?? [];
  const more = built.timeline_more ?? 0;
  // A newer build than this one stays: two builds of one account (a read
  // and a wake) can finish in either order.
  await db.query(
    `insert into home_feed
       (account_id, window_from, window_to, built_at, build_ms, timezone,
        subjects_key, items, more, read_at)
     values ($1, $2, $3, $3, $4, $5, $6, $7::jsonb, $8, $9)
     on conflict (account_id) do update
        set window_from = excluded.window_from,
            window_to = excluded.window_to,
            built_at = excluded.built_at,
            build_ms = excluded.build_ms,
            timezone = excluded.timezone,
            subjects_key = excluded.subjects_key,
            items = excluded.items,
            more = excluded.more,
            read_at = coalesce(excluded.read_at, home_feed.read_at)
      where home_feed.built_at < excluded.built_at`,
    [
      accountId,
      new Date(fromMs),
      new Date(now),
      buildMs,
      timezone,
      homeKey(subjects, accounts),
      JSON.stringify(items.map(storedItem)),
      more,
      readAt === null ? null : new Date(readAt),
    ],
  );
  const week = { fromMs, toMs: now, items, more, builtMs: now, buildMs };
  if (storyBuild === "on")
    week.story = {
      mode: "on",
      ...storyCounts(built.stored_players),
      build_ms: buildMs,
    };
  else if (storyBuild === "shadow") {
    // After the computed week is stored, and never its failure: a shadow
    // that throws is a count of its own.
    const shadowStarted = Date.now();
    try {
      const other = await mixed();
      week.story = {
        mode: "shadow",
        ...storyCounts(other.stored_players),
        computed_ms: buildMs,
        mixed_ms: Date.now() - shadowStarted,
        diff: compareWeeks(built, other, { fromMs, basis: "observed" }),
      };
    } catch (err) {
      week.story = {
        mode: "shadow",
        computed_ms: buildMs,
        mixed_ms: Date.now() - shadowStarted,
        failed: err?.code ?? err?.name ?? "error",
      };
    }
  }
  if (clansMode === "on")
    week.storyClans = {
      mode: "on",
      ...clanCounts(built.stored_clans),
      build_ms: buildMs,
    };
  else if (clansMode === "shadow") {
    // After the week is stored, and never its failure, as stage 4's.
    const shadowStarted = Date.now();
    try {
      const other = await allStored();
      week.storyClans = {
        mode: "shadow",
        ...clanCounts(other.stored_clans),
        base_ms: buildMs,
        mixed_ms: Date.now() - shadowStarted,
        diff: compareClanWeeks(built, other, { fromMs }),
      };
    } catch (err) {
      week.storyClans = {
        mode: "shadow",
        base_ms: buildMs,
        mixed_ms: Date.now() - shadowStarted,
        failed: err?.code ?? err?.name ?? "error",
      };
    }
  }
  return week;
}

/** TIMELINE_STORY_BUILD as a mode: `off` unless it says `shadow` or
 *  `on`. */
export const storyBuildOf = (v) => (v === "shadow" || v === "on" ? v : "off");
/** TIMELINE_STORY_BUILD_CLANS as a mode (stage 6): the same parse. */
export const storyClansBuildOf = (v) => storyBuildOf(v);

/** The one log line of a stage-6 build (`home_feed_story_clans`), beside
 *  stage 4's: counts, ms and story ids only, never a tag, a name or an
 *  item's content. `door` as logStoryBuild's. */
export function logStoryClans(log, door, story) {
  try {
    log(JSON.stringify({ at: "home_feed_story_clans", door, ...story }));
  } catch {
    // A log that fails never fails the week.
  }
}

/** A build's stored-clan counts as the log carries them: no tag. */
const clanCounts = (c) => ({
  clans_stored: c?.stored ?? 0,
  clans_computed: c?.computed ?? {},
  read_ms: c?.ms ?? 0,
  ...(c?.error ? { read_error: c.error } : {}),
});

/** No kind is labelled observed_basis by kind alone for a clan: its rows
 *  keep each kind's observed instant (story-clans.mjs). */
const NO_EDGE_KINDS = new Set();

/**
 * Stage 6's comparison: the stored week (players from rows, clans built)
 * beside the same week with clans from their rows too. Both builds read
 * players' rows, moments apart, so a difference can be a player's rows
 * moving between them. A difference is a stored clan's only when its id
 * is one a clan served from rows in the second build told, in either
 * build (`clan_told`: what each clan subject's items carried, built or
 * cut, before any merge); anything else is `not_clan`. A clan's is
 * `unwritten` when it was learned after that clan's write (the earliest,
 * when several stored clans tell it), then compareWeeks' `cap_edge`,
 * `observed_basis` (it sorts before the week), `window` and `settled`.
 */
function compareClanWeeks(base, mixed, { fromMs }) {
  const written = mixed.stored_clans_written ?? new Map();
  const toldBy = [base.clan_told, mixed.clan_told].filter(Boolean);
  const clanOf = (it) => {
    let best = null;
    for (const [tag, ms] of written)
      if (
        toldBy.some((t) => t.get(tag)?.has(it.id)) &&
        (best === null || ms < written.get(best))
      )
        best = tag;
    return best;
  };
  return compareWeeks(base, mixed, {
    fromMs,
    basis: "observed",
    edgeKinds: NO_EDGE_KINDS,
    saidGate: false,
    storedOf: clanOf,
    written,
    unstoredCause: "not_clan",
  });
}

/** The one log line of a stage-4 build: counts, ms and story ids only,
 *  never a tag, a name or an item's content. `door` says which build:
 *  `home_sync` (the timeline-sync lane) or `home_read` (a read's own). */
export function logStoryBuild(log, door, story) {
  try {
    log(JSON.stringify({ at: "home_feed_story_build", door, ...story }));
  } catch {
    // A log that fails never fails the week.
  }
}

/** A mixed build's counts as the log carries them: no tag. */
const storyCounts = (c) => ({
  players_stored: c?.stored ?? 0,
  players_computed: c?.computed ?? {},
  read_ms: c?.ms ?? 0,
  ...(c?.error ? { read_error: c.error } : {}),
});

/** Ids one comparison names per class, at most. */
const DIFF_SAMPLE = 5;
/** A story this close to the window's start can differ by the window
 *  alone (compareStories' WINDOW_EDGE_MS). */
const DIFF_WINDOW_EDGE_MS = 2 * 86_400_000;
/** Kinds whose observed instant a row keeps differently from an observed
 *  build's select (the note, "Observed basis"). */
const OBSERVED_EDGE_KINDS = new Set(["member_role_changed", "returned"]);

/**
 * Two finished builds of one reader's week, by item id: the computed one
 * (every player built) and the mixed one (followed players from their
 * stored rows). Counts and at most DIFF_SAMPLE ids per class, never an
 * item's content or a tag:
 *
 *  - `only_computed`, `only_mixed`: an id one build tells and not the
 *    other;
 *  - `revision`: both tell it at other revisions;
 *  - `content`: one revision, other content (finishedHash: the whole
 *    finished item, reader's fields included);
 *  - `order_same`: whether the ids both tell come in one order.
 *
 * Each difference has a cause: `cap_edge` (the other build's cap left it
 * out), `computed` (no stored player is its subject: a copy merged with a
 * stored one moved), `unwritten` (learned after the player's write),
 * `said_gate` (a quiet crossing the build's said gate and saidStories
 * judge apart), `observed_basis` (the row's instant is not what the
 * observed select read: it sorts before the window, or is a kind the
 * note names), `window` (within two days of the window's start) or
 * `settled` (none of these: what the next stage must explain). `groups`
 * counts them by kind, class, cause and, for content, field.
 *
 * A clan's shadow (stage 5, 2026-11-26; story-clans.mjs) compares a build
 * with the window cut from its rows: `other` names the second side
 * (`stored`: its count and `only_stored`), `edgeKinds` are the kinds
 * labelled `observed_basis` whatever their instant (none: a clan row
 * keeps each kind's observed instant), and `saidGate: false` (a clan's
 * entry has no said gate). `storedOf` names the stored subject of an
 * item (a clan's: the clan, whatever member the item is about), or null.
 * `written` (stage 6, 2026-11-27) is the Map of stored subject to its
 * write's ms in place of `mixed.stored_written` (Home's clans: a Map of
 * clan tags, apart from the players'), and `unstoredCause` names a
 * difference on an item no stored subject told (`computed` unless
 * said).
 */
export function compareWeeks(
  computed,
  mixed,
  {
    fromMs,
    basis,
    other = "mixed",
    edgeKinds = OBSERVED_EDGE_KINDS,
    saidGate = true,
    storedOf = null,
    written = null,
    unstoredCause = "computed",
  },
) {
  const onlyOther = `only_${other}`;
  const storedWritten = written ?? mixed.stored_written ?? new Map();
  const a = new Map((computed.timeline ?? []).map((it) => [it.id, it]));
  const b = new Map((mixed.timeline ?? []).map((it) => [it.id, it]));
  const droppedA = new Set(
    (computed.timeline_dropped ?? []).map((it) => it.id),
  );
  const droppedB = new Set((mixed.timeline_dropped ?? []).map((it) => it.id));
  const out = {
    computed: a.size,
    [other]: b.size,
    only_computed: 0,
    [onlyOther]: 0,
    revision: 0,
    content: 0,
    order_same: true,
    ids: { only_computed: [], [onlyOther]: [], revision: [], content: [] },
    groups: [],
  };
  const counted = new Map();
  const count = (kind, bucket, cause, field = null) => {
    const key = JSON.stringify([kind, bucket, cause, field]);
    const g = counted.get(key) ?? { kind, bucket, cause, field, n: 0 };
    g.n += 1;
    counted.set(key, g);
  };
  const note = (bucket, id) => {
    out[bucket] += 1;
    if (out.ids[bucket].length < DIFF_SAMPLE) out.ids[bucket].push(id);
  };
  const storedTag = (it) =>
    storedOf
      ? storedOf(it)
      : storedWritten.has(it.subject_tag)
        ? it.subject_tag
        : ((it.subjects ?? []).find(
            (s) => s.kind === "player" && storedWritten.has(s.tag),
          )?.tag ?? null);
  const causeOf = (it, bucket) => {
    if (
      (bucket === "only_computed" && droppedB.has(it.id)) ||
      (bucket === onlyOther && droppedA.has(it.id))
    )
      return "cap_edge";
    const tag = storedTag(it);
    if (tag === null) return unstoredCause;
    const learned = Date.parse(it.observed_at ?? it.at);
    if (learned > storedWritten.get(tag)) return "unwritten";
    if (saidGate && bucket === "only_computed" && it.kind === "quiet_crossed")
      return "said_gate";
    const sortMs = Date.parse(it.sort_at ?? it.at);
    if (basis === "observed" && (sortMs <= fromMs || edgeKinds.has(it.kind)))
      return "observed_basis";
    if (Math.min(Date.parse(it.at), sortMs) <= fromMs + DIFF_WINDOW_EDGE_MS)
      return "window";
    return "settled";
  };
  for (const [id, it] of a) {
    const other = b.get(id);
    if (!other) {
      note("only_computed", id);
      count(it.kind, "only_computed", causeOf(it, "only_computed"));
    } else if ((it.revision ?? 1) !== (other.revision ?? 1)) {
      note("revision", id);
      count(it.kind, "revision", causeOf(it, "revision"));
    } else if (finishedHash(it) !== finishedHash(other)) {
      note("content", id);
      const cause = causeOf(it, "content");
      const fields = changedFields(plainItem(it), plainItem(other));
      for (const f of fields.length ? fields : ["unread"])
        count(it.kind, "content", cause, f);
    }
  }
  for (const [id, it] of b)
    if (!a.has(id)) {
      note(onlyOther, id);
      count(it.kind, onlyOther, causeOf(it, onlyOther));
    }
  const common = (m, other) => [...m.keys()].filter((id) => other.has(id));
  const ca = common(a, b);
  const cb = common(b, a);
  out.order_same = ca.every((id, i) => id === cb[i]);
  out.groups = [...counted.values()]
    .sort(
      (x, y) =>
        y.n - x.n ||
        JSON.stringify([x.kind, x.bucket, x.cause, x.field]).localeCompare(
          JSON.stringify([y.kind, y.bucket, y.cause, y.field]),
        ),
    )
    .slice(0, 25);
  out.groups_cut = Math.max(0, counted.size - 25);
  return out;
}

/** The stored row, or null. */
async function storedWeek(db, accountId) {
  const { rows } = await db.query(
    `select window_from, window_to, built_at, timezone, subjects_key, items,
            more, read_at
       from home_feed where account_id = $1`,
    [accountId],
  );
  return rows[0] ?? null;
}

/** The instant an item last changed for a reader: the later of when it
 *  sorts (a sitting's last battle) and when Elixir learned it. A battle
 *  learned late sorts below the feed's top but is still news (Codex on
 *  #1038). */
export const changedAt = (it) =>
  Math.max(
    Date.parse(it.sort_at ?? it.at) || 0,
    Date.parse(it.observed_at ?? it.at) || 0,
  );

/** The app's New policy: a post counts once at creation; game stories
 * can become new when they grow or are learned later. Both the mark and
 * count use this instant, so an edit cannot advance past an unread post.
 */
export const feedNewsAt = (it) =>
  it.kind === "post" ? Date.parse(it.at) || 0 : changedAt(it);

/** Items read live over the stored week, never stored or counted. */
export const liveItem = (it) =>
  it.kind === "battle_highlight" || it.section === "attested";

/** The newest change among a week's stored items, as an ISO instant, or
 *  null: the mark the feed's first page hands the pill to count from. */
export function feedWatermark(items) {
  let best = 0;
  for (const it of items)
    if (!liveItem(it)) best = Math.max(best, feedNewsAt(it));
  return best > 0 ? new Date(best).toISOString() : null;
}

/**
 * How many of the stored week's items changed after `sinceMs` (the first
 * page's watermark, feedWatermark), and when the week was built: Home's
 * "N new" pill (2026-11-14). An item counts when it sorts later or was
 * learned later, so a battle learned late, below the feed's top, counts. One statement on the account's one row, never
 * a build and never the record: the five-minute wake keeps the row fresh
 * for anyone who reads Home, so the count follows the record within FRESH.
 * Highlights and attested facts are read live by the feed (readHomeWeek),
 * not stored, so they are not counted here; a highlight shows at the next
 * read of the feed. Null when the account has no stored week.
 */
export async function countHomeNew(db, accountId, sinceMs) {
  const { rows } = await db.query(
    `select f.built_at,
            (select count(*)::int from jsonb_array_elements(f.items) it
              where greatest(
                      coalesce(it->>'sort_at', it->>'at')::timestamptz,
                      coalesce(it->>'observed_at', it->>'at')::timestamptz
                    ) > $2
                and it->>'kind' is distinct from 'battle_highlight'
                and it->>'section' is distinct from 'attested') as fresh
       from home_feed f where f.account_id = $1`,
    [accountId, new Date(sinceMs)],
  );
  const row = rows[0];
  return row ? { fresh: row.fresh, builtAt: row.built_at } : null;
}

/**
 * Home's week for a read: the stored one when it was built for these
 * subjects and this time zone and is no older than SERVE, else built now.
 * `wake(accountId, now)` asks the background for a fresh build when the
 * stored one is past FRESH; null = no lane (tests, local runs).
 * `window` pins a page to the week its first page read (More, evidence):
 * a stored row of another window is not that week, and null is returned.
 */
export async function readHomeWeek(
  db,
  accountId,
  {
    timezone,
    now = Date.now(),
    wake = null,
    window = null,
    perf = null,
    // A build on read follows TIMELINE_STORY_BUILD when it is `on`
    // (buildHomeWeek), and logs its home_feed_story_build line through
    // `log`. `shadow` is the lane's alone: a person's read never waits
    // for a second build that only compares.
    storyBuild = "off",
    // TIMELINE_STORY_BUILD_CLANS (stage 6): a build on read follows it
    // only at `on` (and only while storyBuild is `on`), and logs its
    // home_feed_story_clans line; `shadow` is the lane's alone too.
    storyClans = "off",
    log = console.info,
  },
) {
  const subjects = await subjectsFor(db, accountId);
  const accounts = await followedAccountIds(db, accountId);
  const key = homeKey(subjects, accounts);
  const row = await storedWeek(db, accountId);
  let age = row ? now - row.built_at.getTime() : Infinity;
  const serves = (r) =>
    r &&
    r.subjects_key === key &&
    r.timezone === timezone &&
    now - r.built_at.getTime() <= HOME_SERVE_MS;
  let week;
  if (window) {
    if (
      !row ||
      row.subjects_key !== key ||
      row.timezone !== timezone ||
      row.window_from.getTime() !== window.fromMs ||
      row.window_to.getTime() !== window.toMs
    )
      return null;
    week = fromRow(row);
  } else if (serves(row)) {
    week = fromRow(row);
    if (age > HOME_FRESH_MS && wake)
      await wake(accountId, now).catch((err) =>
        console.error(
          JSON.stringify({
            at: "home_feed_wake_failed",
            code: err?.code ?? err?.name ?? null,
          }),
        ),
      );
    if (!row.read_at || now - row.read_at.getTime() >= READ_MARK_MS)
      await db.query(
        `update home_feed set read_at = $2 where account_id = $1`,
        [accountId, new Date(now)],
      );
  } else {
    // One build at a time: a read that finds another building this
    // account's week waits for it and serves what it stored.
    week = await buildOnce(db, "home_feed", accountId, {
      build: async () => ({
        ...(await buildHomeWeek(db, accountId, {
          subjects,
          accounts,
          timezone,
          now,
          readAt: now,
          perf,
          storyBuild: storyBuild === "on" ? "on" : "off",
          storyClans: storyClans === "on" ? "on" : "off",
        })),
        stored: false,
      }),
      reuse: async () => {
        const kept = await storedWeek(db, accountId);
        if (!serves(kept)) return null;
        age = Math.max(0, now - kept.built_at.getTime());
        return fromRow(kept);
      },
    });
  }
  if (week.story) logStoryBuild(log, "home_read", week.story);
  if (week.storyClans) logStoryClans(log, "home_read", week.storyClans);
  // Read live over the stored items, a statement each: highlights, so a
  // post, an edit or a removal shows at once; attested facts, because who
  // may see a clan or leaders' fact is decided at the read (factItems),
  // and a reader who left the clan or lost the role must stop seeing it
  // now, not at the next build (Codex on #818).
  const live = { fromMs: week.fromMs, toMs: Math.max(now, week.toMs) };
  const highlights = await windowHighlights(db, subjects, {
    accountId,
    ...live,
    timezone,
  });
  const facts = await windowFacts(db, subjects, {
    accountId,
    ...live,
    timezone,
  });
  const items = (
    await clanStoriesFor(
      db,
      [
        ...week.items.filter(
          (it) => it.kind !== "battle_highlight" && it.section !== "attested",
        ),
        ...highlights,
        ...facts,
      ],
      subjects,
      { accountId, ...live, timezone },
    )
  ).sort(feedOrder);
  return {
    subjects,
    fromMs: week.fromMs,
    toMs: week.toMs,
    items,
    more: week.more,
    stored: week.stored,
    ageMs: week.stored ? age : 0,
  };
}

/**
 * The stored week as the RSS feed reads it (2026-11-22). The feed used to
 * build seven days of every followed player and clan on each poll (p50
 * 0.9 s, and a reader polls about every twenty minutes); it reads Home's
 * row instead, so a poll is a select.
 *
 * What the feed may carry is narrower than Home, and decided here, at the
 * read, never by what was stored:
 * - no leaders-only fact: attested facts are read live and not
 *   interactively (`windowFacts`, `interactive: false`), as the feed's own
 *   build read them;
 * - no people line (section `people`): the feed's build never asked for
 *   them (`buildTimeline` without `people`);
 * - game words only: the clan-story overlay (`clanStoriesFor`) is Home's.
 *
 * A poll is not a read of Home, so `read_at` is left alone: the row stays
 * fresh through the poll's own wake past FRESH, and with no servable row
 * the poll builds Home's week once (one build at a time) and stores it.
 * So the feed is at most SERVE old and, for a reader that keeps polling,
 * about one poll behind.
 *
 * One week the row cannot answer (Codex on #1188): Home's cap counts the
 * people lines and leaders-only facts the feed drops, so a week cut at
 * the cap (`more`) may have lost stories the feed owes. When a cut week
 * holds fewer stories than the feed serves (`need`), the poll builds the
 * feed's own week from the record, as every poll did before; with `need`
 * stories or more, the cut ones are older than any the feed would serve.
 */
export async function readFeedWeek(
  db,
  accountId,
  { timezone, now = Date.now(), wake = null, need = 50 },
) {
  const subjects = await subjectsFor(db, accountId);
  const accounts = await followedAccountIds(db, accountId);
  const key = homeKey(subjects, accounts);
  const serves = (r) =>
    r &&
    r.subjects_key === key &&
    r.timezone === timezone &&
    now - r.built_at.getTime() <= HOME_SERVE_MS;
  const row = await storedWeek(db, accountId);
  let week;
  if (serves(row)) {
    week = fromRow(row);
    if (now - row.built_at.getTime() > HOME_FRESH_MS && wake)
      await wake(accountId, now).catch((err) =>
        console.error(
          JSON.stringify({
            at: "home_feed_wake_failed",
            code: err?.code ?? err?.name ?? null,
          }),
        ),
      );
  } else {
    week = await buildOnce(db, "home_feed", accountId, {
      build: async () => ({
        ...(await buildHomeWeek(db, accountId, {
          subjects,
          accounts,
          timezone,
          now,
        })),
        stored: false,
      }),
      reuse: async () => {
        const kept = await storedWeek(db, accountId);
        return serves(kept) ? fromRow(kept) : null;
      },
    });
  }
  const stories = week.items.filter(
    (it) => !liveItem(it) && it.section !== "people",
  );
  if ((week.more ?? 0) > 0 && stories.length < need) {
    const built = await buildTimeline(db, subjects, {
      fromMs: now - HOME_WEEK_MS,
      toMs: now,
      timezone,
      accountId,
      accountLines: false,
      lateCounts: false,
    });
    return {
      subjects,
      fromMs: now - HOME_WEEK_MS,
      toMs: now,
      items: built.timeline ?? [],
      stored: false,
    };
  }
  const live = { fromMs: week.fromMs, toMs: Math.max(now, week.toMs) };
  const highlights = await windowHighlights(db, subjects, {
    accountId,
    ...live,
    timezone,
  });
  const facts = await windowFacts(db, subjects, {
    accountId,
    ...live,
    timezone,
    interactive: false,
  });
  return {
    subjects,
    fromMs: week.fromMs,
    toMs: live.toMs,
    items: [...stories, ...highlights, ...facts],
    stored: week.stored,
  };
}

/** Newest first by the instant shown, then by id: one total order, so a
 *  page's place can be the last item it served (feedAfter). */
export function feedOrder(a, b) {
  return (
    Date.parse(shownAt(b)) - Date.parse(shownAt(a)) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** Whether `it` comes after the item a page ended on ({ at: ms, id }) in
 *  feedOrder. */
export const feedAfter = (it, last) => {
  const ms = Date.parse(shownAt(it));
  return ms < last.at || (ms === last.at && it.id > last.id);
};

const fromRow = (row) => ({
  fromMs: row.window_from.getTime(),
  toMs: row.window_to.getTime(),
  items: row.items.map(restoredItem),
  more: row.more,
  stored: true,
});

/**
 * The background build for one account (the timeline-sync lane's
 * `{ v: 1, home_feed }`): skipped when a build newer than FRESH is
 * already stored, as a second wake of the same slot finds it.
 */
export async function refreshHomeWeek(
  db,
  accountId,
  {
    now = Date.now(),
    since = null,
    storyBuild = "off",
    storyClans = "off",
  } = {},
) {
  const row = await storedWeek(db, accountId);
  // The bell's week rides the same wake (bell_week, 0247): built here
  // when it is missing or past FRESH, so the first bell is never cold.
  const bell = await refreshBellWeek(db, accountId, { now });
  // A wake with `since` (your own battles read now, 2026-11-14) wants a
  // week built after that read, however fresh the row is otherwise.
  const sinceMs = since ? Date.parse(since) : NaN;
  const kept = (r) =>
    r &&
    now - r.built_at.getTime() < HOME_FRESH_MS &&
    !(r.built_at.getTime() < sinceMs);
  if (kept(row)) return { skipped: "fresh", ...(bell ? { bell } : {}) };
  const { timezone } = await homeAccount(db, accountId);
  const subjects = await subjectsFor(db, accountId);
  const accounts = await followedAccountIds(db, accountId);
  const week = await buildOnce(db, "home_feed", accountId, {
    build: () =>
      buildHomeWeek(db, accountId, {
        subjects,
        accounts,
        timezone,
        now,
        storyBuild,
        storyClans,
      }),
    // A read built it meanwhile: nothing left to do.
    reuse: async () => {
      const stored = await storedWeek(db, accountId);
      return kept(stored) ? { items: stored.items, buildMs: 0 } : null;
    },
  });
  return {
    items: week.items.length,
    build_ms: week.buildMs,
    ...(bell ? { bell } : {}),
    // The lane logs each as its own line (logStoryBuild, logStoryClans),
    // not in this one.
    ...(week.story ? { story: week.story } : {}),
    ...(week.storyClans ? { story_clans: week.storyClans } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* The bell's week (bell_week, 0247)                                   */
/* ------------------------------------------------------------------ */

/** Your own players that you verified: the only players the bell speaks
 *  of, primary first. */
export async function ownVerifiedPlayers(db, accountId) {
  const { rows } = await db.query(
    `select c.player_tag, p.name
       from claim c left join player p using (player_tag)
      where c.account_id = $1 and c.status = 'verified'
        and (c.is_primary or c.relationship in ('primary', 'alt'))
      order by c.is_primary desc, c.player_tag`,
    [accountId],
  );
  return rows.map((r) => ({ tag: r.player_tag, name: r.name ?? null }));
}

/** The subjects the bell's week is built for: each own player as your
 *  own, whatever Home calls an alt. */
const ownSubjects = (own) =>
  own.map((p) => ({
    kind: "player",
    tag: p.tag,
    relationship: "primary",
    nickname: null,
  }));

/** Items another person can cheer: an id, and never your account's own
 *  lines. */
export const cheerable = (it) =>
  Boolean(it?.id) && it.section !== "account" && it.section !== "people";

/**
 * Build the seven days of the account's own players ending `now` and
 * store the items that take cheers. The build is the one the bell made on
 * every read before 2026-11-12: the same subjects, reader and window.
 */
export async function buildBellWeek(db, accountId, { own, now = Date.now() }) {
  const fromMs = now - HOME_WEEK_MS;
  const started = Date.now();
  const built = await buildTimeline(db, ownSubjects(own), {
    fromMs,
    toMs: now,
    accountId,
    interactive: true,
    // Your account's own lines take no cheers.
    accountLines: false,
    // Items only: no entry, so no late count to read.
    lateCounts: false,
  });
  const buildMs = Date.now() - started;
  const items = (built.timeline ?? []).filter(cheerable);
  await db.query(
    `insert into bell_week
       (account_id, window_from, window_to, built_at, build_ms, own_key, items)
     values ($1, $2, $3, $3, $4, $5, $6::jsonb)
     on conflict (account_id) do update
        set window_from = excluded.window_from,
            window_to = excluded.window_to,
            built_at = excluded.built_at,
            build_ms = excluded.build_ms,
            own_key = excluded.own_key,
            items = excluded.items
      where bell_week.built_at < excluded.built_at`,
    [
      accountId,
      new Date(fromMs),
      new Date(now),
      buildMs,
      subjectsKey(ownSubjects(own)),
      JSON.stringify(items.map(storedItem)),
    ],
  );
  return { fromMs, toMs: now, items, buildMs };
}

async function storedBellWeek(db, accountId) {
  const { rows } = await db.query(
    `select window_from, window_to, built_at, own_key, items
       from bell_week where account_id = $1`,
    [accountId],
  );
  return rows[0] ?? null;
}

/**
 * The bell's week for a read: the stored one when it was built for these
 * own players and is no older than SERVE (past FRESH it also wakes the
 * background build), else built now and stored. Highlights and attested
 * facts are read live over it, as Home reads them. Returns cheerable
 * items, newest first. `maxAgeMs` narrows SERVE for a read that must see
 * items made since (the activity mail and push, 2026-11-16).
 */
export async function readBellWeek(
  db,
  accountId,
  { own, now = Date.now(), wake = null, maxAgeMs = null },
) {
  if (own.length === 0) return { items: [], stored: false, ageMs: 0 };
  const subjects = ownSubjects(own);
  const row = await storedBellWeek(db, accountId);
  let age = row ? now - row.built_at.getTime() : Infinity;
  const serves = (r) =>
    r &&
    r.own_key === subjectsKey(subjects) &&
    now - r.built_at.getTime() <= (maxAgeMs ?? HOME_SERVE_MS);
  let week;
  if (serves(row)) {
    week = { ...fromRow(row), more: 0 };
    if (age > HOME_FRESH_MS && wake)
      await wake(accountId, now).catch((err) =>
        console.error(
          JSON.stringify({
            at: "bell_week_wake_failed",
            code: err?.code ?? err?.name ?? null,
          }),
        ),
      );
  } else {
    week = await buildOnce(db, "bell_week", accountId, {
      build: async () => ({
        ...(await buildBellWeek(db, accountId, { own, now })),
        stored: false,
      }),
      reuse: async () => {
        const kept = await storedBellWeek(db, accountId);
        if (!serves(kept)) return null;
        age = Math.max(0, now - kept.built_at.getTime());
        return { ...fromRow(kept), more: 0 };
      },
    });
  }
  const live = { fromMs: week.fromMs, toMs: Math.max(now, week.toMs) };
  const highlights = await windowHighlights(db, subjects, {
    accountId,
    ...live,
  });
  const facts = await windowFacts(db, subjects, { accountId, ...live });
  const items = (
    await clanStoriesFor(
      db,
      [
        ...week.items.filter(
          (it) => it.kind !== "battle_highlight" && it.section !== "attested",
        ),
        ...highlights,
        ...facts,
      ],
      subjects,
      { accountId, ...live },
    )
  )
    .filter(cheerable)
    .sort(feedOrder);
  return { items, stored: week.stored, ageMs: week.stored ? age : 0 };
}

/** The background build of the bell's week: null when it is fresh, or
 *  when there is no row and no own player to build one for. A missing row
 *  is built too, so the bell's first read after its table is new, or after
 *  a first verification, finds one waiting (round four, #649). */
async function refreshBellWeek(db, accountId, { now }) {
  const row = await storedBellWeek(db, accountId);
  if (row && now - row.built_at.getTime() < HOME_FRESH_MS) return null;
  const own = await ownVerifiedPlayers(db, accountId);
  // No own player: the read answers empty without the row.
  if (own.length === 0) return row ? { skipped: "no_players" } : null;
  const week = await buildOnce(db, "bell_week", accountId, {
    build: () => buildBellWeek(db, accountId, { own, now }),
    reuse: async () => {
      const kept = await storedBellWeek(db, accountId);
      return kept && now - kept.built_at.getTime() < HOME_FRESH_MS
        ? { items: kept.items, buildMs: 0 }
        : null;
    },
  });
  return { items: week.items.length, build_ms: week.buildMs };
}

/** The accounts the five-minute run wakes, recent readers first and then
 *  the oldest row: read Home in
 *  the last three days and built more than FRESH ago, or read it in the
 *  last week and built more than two hours ago. A week away keeps the row
 *  under SERVE, so the first read back serves it rather than building. */
export async function homeWeeksToWake(db, { now = Date.now() } = {}) {
  const { rows } = await db.query(
    `select account_id from home_feed
      where (read_at > $1 and built_at < $2)
         or (read_at > $3 and built_at < $4)
      order by read_at > $1 desc, built_at limit $5`,
    [
      new Date(now - HOME_READ_RECENT_MS),
      new Date(now - HOME_FRESH_MS),
      new Date(now - HOME_READ_IDLE_MS),
      new Date(now - HOME_IDLE_REBUILD_MS),
      WAKES_PER_RUN,
    ],
  );
  return rows.map((r) => r.account_id);
}

/** The outbox object that wakes one account's build: one per account a
 *  quarter hour, however many reads and runs ask. With `since` (an ISO
 *  instant: one of your own battle logs read now, 2026-11-14), one per
 *  read, and the build happens unless the row was built after it. */
export function homeWeekWake(outbox) {
  if (!outbox) return null;
  return (accountId, now = Date.now(), { since = null } = {}) =>
    outbox(
      "timeline-sync",
      since
        ? { v: 1, home_feed: accountId, since }
        : { v: 1, home_feed: accountId },
      {
        id: since
          ? `home.${accountId}.since.${Date.parse(since)}`
          : `home.${accountId}.${Math.floor(now / HOME_FRESH_MS)}`,
        once: true,
      },
    );
}
