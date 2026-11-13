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
  restoredItem,
  shownAt,
  storedItem,
  subjectsFor,
  windowFacts,
  windowHighlights,
} from "./entries.mjs";

/** The week Home shows. */
export const HOME_WEEK_MS = 7 * 86_400_000;
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
 *  finish before it builds one itself. */
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

/**
 * One build of an account's stored row at a time. Two cold reads of one
 * account (two panels, two tabs, a read and the background lane) used to
 * build the same row side by side, each holding a pool client and the
 * database for seconds. `build` runs under a session advisory lock keyed
 * by `name` and the account; a second caller waits for it (at most
 * BUILD_WAIT_MS, holding no lock of its own) and then asks `reuse` for
 * what the first stored, building only when that answers null.
 */
export async function buildOnce(db, name, accountId, { build, reuse }) {
  const key = [name, String(accountId)];
  const { rows } = await db.query(
    `select pg_try_advisory_lock(hashtext($1), hashtext($2)) as ok`,
    key,
  );
  if (rows[0]?.ok) {
    try {
      return await build();
    } finally {
      await db
        .query(`select pg_advisory_unlock(hashtext($1), hashtext($2))`, key)
        .catch(() => {});
    }
  }
  // Another build of this row is running: wait for it, then read it.
  const waited = await waitForBuild(db, key);
  if (waited) {
    const kept = await reuse();
    if (kept) return kept;
  }
  return build();
}

/** Wait until the holder of `key` lets go, never holding it: true when it
 *  did within BUILD_WAIT_MS. */
async function waitForBuild(db, key) {
  const until = Date.now() + BUILD_WAIT_MS;
  for (let pause = 100; Date.now() < until; pause = Math.min(pause * 2, 800)) {
    await new Promise((r) => setTimeout(r, pause));
    const { rows } = await db.query(
      `select not exists (
         select 1 from pg_locks
          where locktype = 'advisory' and granted
            and classid = hashtext($1)::oid and objid = hashtext($2)::oid
            and objsubid = 2) as free`,
      key,
    );
    if (rows[0]?.free) return true;
  }
  return false;
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
  { subjects, timezone, now = Date.now(), readAt = null, perf = null },
) {
  const fromMs = now - HOME_WEEK_MS;
  const started = Date.now();
  const built = await buildTimeline(db, subjects, {
    fromMs,
    toMs: now,
    timezone,
    accountId,
    interactive: true,
    accountLines: false,
    perf,
  });
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
      subjectsKey(subjects),
      JSON.stringify(items.map(storedItem)),
      more,
      readAt === null ? null : new Date(readAt),
    ],
  );
  return { fromMs, toMs: now, items, more, builtMs: now, buildMs };
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
  { timezone, now = Date.now(), wake = null, window = null, perf = null },
) {
  const subjects = await subjectsFor(db, accountId);
  const key = subjectsKey(subjects);
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
          timezone,
          now,
          readAt: now,
          perf,
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
  const items = [
    ...week.items.filter(
      (it) => it.kind !== "battle_highlight" && it.section !== "attested",
    ),
    ...highlights,
    ...facts,
  ].sort(feedOrder);
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
  { now = Date.now() } = {},
) {
  const row = await storedWeek(db, accountId);
  // The bell's week rides the same wake (bell_week, 0247): built here
  // when it is missing or past FRESH, so the first bell is never cold.
  const bell = await refreshBellWeek(db, accountId, { now });
  if (row && now - row.built_at.getTime() < HOME_FRESH_MS)
    return { skipped: "fresh", ...(bell ? { bell } : {}) };
  const { timezone } = await homeAccount(db, accountId);
  const subjects = await subjectsFor(db, accountId);
  const week = await buildOnce(db, "home_feed", accountId, {
    build: () => buildHomeWeek(db, accountId, { subjects, timezone, now }),
    // A read built it meanwhile: nothing left to do.
    reuse: async () => {
      const kept = await storedWeek(db, accountId);
      return kept && now - kept.built_at.getTime() < HOME_FRESH_MS
        ? { items: kept.items, buildMs: 0 }
        : null;
    },
  });
  return {
    items: week.items.length,
    build_ms: week.buildMs,
    ...(bell ? { bell } : {}),
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
export const cheerable = (it) => Boolean(it?.id) && it.section !== "account";

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
 * items, newest first.
 */
export async function readBellWeek(
  db,
  accountId,
  { own, now = Date.now(), wake = null },
) {
  if (own.length === 0) return { items: [], stored: false, ageMs: 0 };
  const subjects = ownSubjects(own);
  const row = await storedBellWeek(db, accountId);
  let age = row ? now - row.built_at.getTime() : Infinity;
  const serves = (r) =>
    r &&
    r.own_key === subjectsKey(subjects) &&
    now - r.built_at.getTime() <= HOME_SERVE_MS;
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
  const items = [
    ...week.items.filter(
      (it) => it.kind !== "battle_highlight" && it.section !== "attested",
    ),
    ...highlights,
    ...facts,
  ]
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
 *  quarter hour, however many reads and runs ask. */
export function homeWeekWake(outbox) {
  if (!outbox) return null;
  return (accountId, now = Date.now()) =>
    outbox(
      "timeline-sync",
      { v: 1, home_feed: accountId },
      {
        id: `home.${accountId}.${Math.floor(now / HOME_FRESH_MS)}`,
        once: true,
      },
    );
}
