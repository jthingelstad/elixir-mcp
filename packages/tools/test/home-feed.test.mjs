/**
 * Home's stored week (home_feed, 0245; #649): a read serves the row the
 * build stored while it is the same reader's (subjects, time zone) and
 * young enough, asks for a fresh one past fifteen minutes, builds it
 * itself past three hours; highlights are read live over it; the
 * server-only fields (a sitting's sparkline, an item's evidence source)
 * survive the store and are never served. On a scratch database (golden
 * rule 9).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import {
  readTimelineEvidence,
  restoredItem,
  sessionDeck,
  sessionSpark,
  storedItem,
} from "../src/activity/entries.mjs";
import {
  HOME_FRESH_MS,
  HOME_IDLE_REBUILD_MS,
  HOME_SERVE_MS,
  buildOnce,
  homeWeeksToWake,
  homeWeekWake,
  readHomeWeek,
  refreshHomeWeek,
} from "../src/activity/home-feed.mjs";

const T = Date.parse("2026-09-20T12:00:00Z");
const H = 3_600_000;
const at = (ms) => new Date(ms).toISOString();
const PLAYER = "#PYL0Q2G8";

let ctx;
let db;
let owner;
let highlightId;

const read = (now, extra = {}) =>
  readHomeWeek(db, owner, { timezone: "UTC", now, ...extra });
const row = async () =>
  (
    await db.query(
      `select built_at, read_at, jsonb_array_length(items) as n
         from home_feed where account_id = $1`,
      [owner],
    )
  ).rows[0] ?? null;

before(async () => {
  ctx = await scratchDb("home_feed");
  db = ctx.db;
  await db.query(`insert into player (player_tag, name) values ($1, 'me')`, [
    PLAYER,
  ]);
  for (const [i, outcome] of ["win", "loss"].entries()) {
    const id = `home-feed-${i}`;
    const t = T - 2 * H + i * 120_000;
    await db.query(
      `insert into battle (battle_id, battle_time, type, type_class, created_at)
       values ($1, $2, 'PvP', 'pvp', $3)`,
      [id, at(t), at(t + 60_000)],
    );
    await db.query(
      `insert into battle_participant (battle_id, player_tag, battle_time, side,
         type, type_class, crowns, trophy_change, outcome)
       values ($1, $2, $3, 0, 'PvP', 'pvp', $4, $5, $6)`,
      [id, PLAYER, at(t), i ? 0 : 3, i ? -30 : 30, outcome],
    );
  }
  owner = (
    await db.query(
      `insert into account (email_hash, status, timezone)
       values ('home-feed-owner', 'approved', 'UTC') returning account_id`,
    )
  ).rows[0].account_id;
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary, relationship, notify)
     values ($1, $2, 'verified', true, 'primary', true)`,
    [owner, PLAYER],
  );
  highlightId = (
    await db.query(
      `insert into battle_highlight (player_tag, battle_id, account_id, words,
                                     created_at, updated_at)
       values ($1, 'home-feed-0', $2, 'first words', $3, $3)
       returning highlight_id`,
      [PLAYER, owner, at(T - H)],
    )
  ).rows[0].highlight_id;
});

after(async () => ctx?.drop());

test("the server-only fields survive the store and are never served", () => {
  const spark = Symbol.for("not the builder's");
  const it = { id: "x", kind: "battle_session", [spark]: 1 };
  assert.deepEqual(restoredItem(JSON.parse(JSON.stringify(storedItem(it)))), {
    id: "x",
    kind: "battle_session",
  });
});

test("a sitting's deck row survives the store under its symbol, never served", () => {
  const deck = {
    label: "Invented cycle",
    cards: [{ id: 26000000, name: "Knight", form: "base", elixir_cost: 3 }],
  };
  const restored = restoredItem(
    JSON.parse(
      JSON.stringify({ id: "y", kind: "battle_session", _deck: deck }),
    ),
  );
  assert.deepEqual(sessionDeck(restored), deck);
  assert.deepEqual(JSON.parse(JSON.stringify(restored)), {
    id: "y",
    kind: "battle_session",
  });
  // Stored again, it is the same row: a week stored before the deck was
  // kept has no _deck and restores with none.
  assert.deepEqual(storedItem(restored)._deck, deck);
  assert.equal(sessionDeck(restoredItem({ id: "z" })), null);
});

test("the first read builds and stores the week; the next serves the row as built", async () => {
  const first = await read(T);
  assert.equal(first.stored, false);
  const session = first.items.find((it) => it.kind === "battle_session");
  assert.ok(session, "the sitting is in the week");
  assert.ok(sessionSpark(session)?.length === 2, "with its sparkline");
  assert.ok(first.items.some((it) => it.kind === "battle_highlight"));
  const stored = await row();
  assert.equal(stored.built_at.getTime(), T);
  assert.equal(stored.read_at.getTime(), T);

  const woken = [];
  const again = await read(T + 60_000, {
    wake: async (id) => woken.push(id),
  });
  assert.equal(again.stored, true);
  assert.deepEqual(woken, [], "a fresh row asks for nothing");
  assert.equal(again.fromMs, first.fromMs);
  assert.equal(again.toMs, first.toMs);
  assert.deepEqual(
    JSON.parse(JSON.stringify(again.items)),
    JSON.parse(JSON.stringify(first.items)),
    "the same items, as served",
  );
  const kept = again.items.find((it) => it.kind === "battle_session");
  assert.deepEqual(sessionSpark(kept), sessionSpark(session));
  assert.ok(!("_spark" in JSON.parse(JSON.stringify(kept))));
  assert.ok(!("_evidence_source" in JSON.parse(JSON.stringify(kept))));
  // Its evidence reads from the stored item as from the built one.
  const evidence = await readTimelineEvidence(db, kept, {});
  assert.equal(evidence.error, undefined, JSON.stringify(evidence));
});

test("past fresh the row is still served, and a build is asked for once a quarter hour", async () => {
  const woken = [];
  const writes = [];
  const wake = homeWeekWake(async (lane, msg, opts) =>
    writes.push({ lane, msg, opts }),
  );
  const now = T + HOME_FRESH_MS + 60_000;
  const stale = await read(now, {
    wake: async (id, n) => {
      woken.push(id);
      await wake(id, n);
    },
  });
  assert.equal(stale.stored, true);
  assert.deepEqual(woken, [owner]);
  assert.deepEqual(writes, [
    {
      lane: "timeline-sync",
      msg: { v: 1, home_feed: owner },
      opts: {
        id: `home.${owner}.${Math.floor(now / HOME_FRESH_MS)}`,
        once: true,
      },
    },
  ]);
  // The five-minute run wakes it too: read lately, built past fresh.
  assert.deepEqual(await homeWeeksToWake(db, { now }), [owner]);
  assert.deepEqual(await homeWeeksToWake(db, { now: T + 60_000 }), []);
});

test("highlights are read live over the stored week", async () => {
  await db.query(
    `update battle_highlight set words = 'better words', revision = 2,
            updated_at = $2 where highlight_id = $1`,
    [highlightId, at(T + 120_000)],
  );
  const week = await read(T + 180_000);
  assert.equal(week.stored, true);
  const highlights = week.items.filter((it) => it.kind === "battle_highlight");
  assert.equal(highlights.length, 1, "the stored copy is replaced, not added");
  assert.equal(highlights[0].facts.words, "better words");
  assert.equal(highlights[0].revision, 2);
});

test("a page names its week: another stored week is not it", async () => {
  const week = await read(T + 60_000, {
    window: { fromMs: T - 7 * 24 * H, toMs: T },
  });
  assert.equal(week?.stored, true);
  assert.equal(
    await read(T + 60_000, { window: { fromMs: T - 7 * 24 * H, toMs: T - 1 } }),
    null,
  );
});

test("a change of subjects or time zone, or a row past serving, is built again", async () => {
  await db.query(
    `insert into player_nickname (account_id, player_tag, nickname)
     values ($1, $2, 'Me')`,
    [owner, PLAYER],
  );
  const renamed = await read(T + 120_000);
  assert.equal(renamed.stored, false, "a nickname is a change of subjects");
  assert.equal((await row()).built_at.getTime(), T + 120_000);

  const zoned = await readHomeWeek(db, owner, {
    timezone: "America/Chicago",
    now: T + 180_000,
  });
  assert.equal(zoned.stored, false);

  const old = await readHomeWeek(db, owner, {
    timezone: "America/Chicago",
    now: T + 180_000 + HOME_SERVE_MS + 1,
  });
  assert.equal(old.stored, false);
});

test("an older build never replaces a newer one", async () => {
  const before = (await row()).built_at.getTime();
  // A read whose subjects differ builds; one that started earlier than the
  // stored build loses.
  await db.query(
    `update player_nickname set nickname = 'Myself' where account_id = $1`,
    [owner],
  );
  const late = await read(before - 60_000);
  assert.equal(late.stored, false);
  assert.equal((await row()).built_at.getTime(), before);
});

test("the background build skips a fresh row and builds a stale one", async () => {
  const built = (await row()).built_at.getTime();
  const bellRow = async () =>
    (
      await db.query(`select built_at from bell_week where account_id = $1`, [
        owner,
      ])
    ).rows[0] ?? null;
  assert.equal(await bellRow(), null, "the bell has not been read");
  // A missing bell row is built by the same wake, so its first read is
  // never cold.
  const first = await refreshHomeWeek(db, owner, { now: built + 60_000 });
  assert.equal(first.skipped, "fresh");
  assert.ok(first.bell?.items >= 0, JSON.stringify(first));
  assert.equal((await bellRow()).built_at.getTime(), built + 60_000);
  assert.deepEqual(await refreshHomeWeek(db, owner, { now: built + 120_000 }), {
    skipped: "fresh",
  });
  const out = await refreshHomeWeek(db, owner, {
    now: built + HOME_FRESH_MS + 1,
  });
  assert.ok(out.items > 0, JSON.stringify(out));
  assert.equal((await row()).built_at.getTime(), built + HOME_FRESH_MS + 1);
});

test("an account away for days is still rebuilt, under serving, for a week", async () => {
  const { read_at } = await row();
  const readAt = read_at.getTime();
  await db.query(`update home_feed set built_at = $2 where account_id = $1`, [
    owner,
    new Date(readAt + 4 * 24 * H),
  ]);
  // Four days after the last read: not past the idle rebuild yet.
  assert.deepEqual(
    await homeWeeksToWake(db, { now: readAt + 4 * 24 * H + 60_000 }),
    [],
  );
  // Past it, still within the week: woken, so the row stays under SERVE.
  assert.ok(HOME_IDLE_REBUILD_MS < HOME_SERVE_MS);
  assert.deepEqual(
    await homeWeeksToWake(db, {
      now: readAt + 4 * 24 * H + HOME_IDLE_REBUILD_MS + 1,
    }),
    [owner],
  );
  // More than a week away: left alone; the first read back builds.
  assert.deepEqual(await homeWeeksToWake(db, { now: readAt + 8 * 24 * H }), []);
});

test("two builds of one account's row never run at once", async () => {
  const other = new pg.Client({ connectionString: ctx.url });
  await other.connect();
  try {
    let builds = 0;
    let release;
    let building;
    const gate = new Promise((r) => (release = r));
    const started = new Promise((r) => (building = r));
    const first = buildOnce(db, "home_feed", owner, {
      build: async () => {
        builds += 1;
        building();
        await gate;
        return "built";
      },
      reuse: async () => "reused",
    });
    // The first holds the lock once its build has begun: no timer, which
    // under a loaded run let the second ask first (2026-11-13).
    await started;
    // Release only once the second has been refused the lock: its try is
    // in flight when buildOnce returns, and a release before Postgres
    // answers it would hand it a free lock.
    let refused;
    const askedOnce = new Promise((r) => (refused = r));
    let asks = 0;
    const watched = {
      query: async (...args) => {
        const result = await other.query(...args);
        if (++asks === 1) refused(result.rows[0]?.ok);
        return result;
      },
    };
    const second = buildOnce(watched, "home_feed", owner, {
      build: async () => {
        builds += 1;
        return "built twice";
      },
      reuse: async () => "reused",
    });
    assert.equal(await askedOnce, false, "the first holds the lock");
    assert.equal(builds, 1, "the second waits for the first");
    release();
    assert.equal(await first, "built");
    assert.equal(await second, "reused");
    assert.equal(builds, 1);
    // Another row of the same account is not held by it.
    assert.equal(
      await buildOnce(other, "bell_week", owner, {
        build: async () => "own",
        reuse: async () => "reused",
      }),
      "own",
    );
    // With nothing running, it builds at once.
    assert.equal(
      await buildOnce(other, "home_feed", owner, {
        build: async () => "built",
        reuse: async () => null,
      }),
      "built",
    );
  } finally {
    await other.end();
  }
});
