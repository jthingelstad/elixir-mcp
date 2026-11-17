/**
 * The passport store against a real PostgreSQL scratch database
 * (migration 0269): person-only passports with opaque ids; idempotent,
 * serialized grants that return only new levels and freeze their day;
 * ladder facts accepted once, frozen to their first day across a zone
 * change, capped under concurrency and kept across the record's
 * one-year retention; profile latches; the snapshot; reads that never
 * write. Invented tags only; the fixture's player for real battles.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { processResult } from "../../ingest/src/pipeline.mjs";
import { createScratch, dropScratch } from "../../ingest/test/helpers.mjs";
import {
  PASSPORT_ID,
  dismissProfileList,
  ensurePassport,
  grantStamps,
  latchProfile,
  passportIdOf,
  readOwnerPassport,
  readPublicPassport,
  readSnapshot,
  recordFact,
} from "../src/store.mjs";
import { evaluatePassport } from "../src/eligibility.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_stamps_${process.pid}`;
const URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

// The fixture's player (fixtures/player_battlelog), battles on 2026-09-03.
const FIXTURE_PLAYER = "#0QRVVG22J";
const OWN = "#0PYLQ2";
const ALT = "#0GRJCUV";
const QUIET = "#0Q2L8";
const UNREAD = "#0YY9P";
const BACK = "#0LUVR2";

let db;
let db2;
let seq = 0;

/** Run `calls` (each `(client) => promise`) from four connections at
 *  once, each connection working through its share in turn: one client
 *  never carries two transactions at the same time, as in the routes,
 *  which lease one connection per request. */
async function lanes(calls) {
  const clients = await Promise.all(
    Array.from({ length: 4 }, async () => {
      const c = new pg.Client({ connectionString: URL });
      await c.connect();
      return c;
    }),
  );
  try {
    const out = new Array(calls.length);
    await Promise.all(
      clients.map(async (c, lane) => {
        for (let i = lane; i < calls.length; i += clients.length)
          out[i] = await calls[i](c);
      }),
    );
    return out;
  } finally {
    await Promise.all(clients.map((c) => c.end()));
  }
}

async function person({ timezone = "UTC", status = "approved" } = {}) {
  seq += 1;
  const {
    rows: [a],
  } = await db.query(
    `insert into account (email_hash, status, role, timezone)
     values ($1, $2, 'member', $3) returning account_id`,
    [`stamps-${seq}`, status, timezone],
  );
  return a.account_id;
}

async function agentOf(owner) {
  const {
    rows: [a],
  } = await db.query(
    `insert into account (status, role, kind, owned_by_account_id)
     values ('approved', 'member', 'agent', $1) returning account_id`,
    [owner],
  );
  return a.account_id;
}

const claim = (accountId, tag, rel, verified = false) =>
  db.query(
    `insert into claim (account_id, player_tag, is_primary, relationship,
                        status, verified_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      accountId,
      tag,
      rel === "primary",
      rel,
      verified ? "verified" : "unverified",
      verified ? new Date() : null,
    ],
  );

const count = async (sql, params) => (await db.query(sql, params)).rows[0].n;

before(async () => {
  await createScratch(NAME);
  db = new pg.Client({ connectionString: URL });
  db2 = new pg.Client({ connectionString: URL });
  await db.connect();
  await db2.connect();
  for (const [tag, name] of [
    [OWN, "Invented Owner"],
    [ALT, "Invented Alt"],
    [QUIET, "Invented Quiet"],
    [UNREAD, "Invented Unread"],
    [BACK, "Invented Back"],
  ])
    await db.query(`insert into player (player_tag, name) values ($1, $2)`, [
      tag,
      name,
    ]);
  // Real battles for one followed player, through the ingest pipeline.
  await db.query(`insert into player (player_tag) values ($1)`, [
    FIXTURE_PLAYER,
  ]);
  const operator = await person();
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by)
     values ('player', $1, $2)`,
    [FIXTURE_PLAYER, operator],
  );
  const {
    rows: [gw],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'stamps-gw', '127.0.0.1', 'active') returning gateway_id`,
    [operator],
  );
  for (const [endpoint, entityKey, rel, fetchedAt] of [
    ["cards", "GLOBAL", "cards/catalog.json", "2026-09-03T13:00:00Z"],
    [
      "player_battlelog",
      FIXTURE_PLAYER,
      "player_battlelog/with_colosseum_duel.json",
      "2026-09-03T14:30:34Z",
    ],
  ]) {
    const payload = JSON.parse(
      await readFile(path.join(repoRoot, "fixtures", rel), "utf8"),
    );
    const result = await processResult(db, {
      v: 1,
      job: { endpoint, entity_key: entityKey, lane: "bulk" },
      gateway_id: gw.gateway_id,
      fetched_at: fetchedAt,
      status: "ok",
      body_gzip_b64: gzipSync(Buffer.from(JSON.stringify(payload))).toString(
        "base64",
      ),
    });
    assert.equal(result.outcome, "admitted", JSON.stringify(result));
  }
});

after(async () => {
  await db?.end();
  await db2?.end();
  await dropScratch(NAME);
});

test("a person gets one opaque passport id; an agent gets none", async () => {
  const a = await person();
  const first = await ensurePassport(db, a);
  assert.match(first.passport_id, PASSPORT_ID);
  assert.equal(first.created, true);
  const again = await ensurePassport(db, a);
  assert.deepEqual(again, { passport_id: first.passport_id, created: false });
  assert.notEqual(first.passport_id, a);
  assert.equal(await passportIdOf(db, a), first.passport_id);
  const agent = await agentOf(a);
  assert.equal(await ensurePassport(db, agent), null);
  assert.equal(await passportIdOf(db, agent), null);
  // A race between two connections still makes one row.
  const b = await person();
  const [x, y] = await Promise.all([
    ensurePassport(db, b),
    ensurePassport(db2, b),
  ]);
  assert.equal(x.passport_id, y.passport_id);
  assert.equal(
    await count(
      `select count(*)::int as n from account_passport where account_id = $1`,
      [b],
    ),
    1,
  );
  // The agents' public id is untouched.
  const {
    rows: [p],
  } = await db.query(`select public_id from account where account_id = $1`, [
    a,
  ]);
  assert.equal(p.public_id, null);
});

test("grants are idempotent, return only new levels and freeze their day", async () => {
  const a = await person({ timezone: "America/Chicago" });
  // 03:00 UTC on the 15th is still the 14th in Chicago.
  const now = "2026-11-15T03:00:00.000Z";
  const first = await grantStamps(
    db,
    a,
    [{ stamp_id: "cheerleader", level: 2 }],
    { now },
  );
  assert.deepEqual(first.granted, [
    {
      stamp_id: "cheerleader",
      level: 1,
      earned_at: now,
      earned_on: "2026-11-14",
    },
    {
      stamp_id: "cheerleader",
      level: 2,
      earned_at: now,
      earned_on: "2026-11-14",
    },
  ]);
  const retry = await grantStamps(
    db,
    a,
    [{ stamp_id: "cheerleader", level: 2 }],
    { now: "2026-11-16T03:00:00Z" },
  );
  assert.deepEqual(retry.granted, []);
  // A zone change never moves an earned day.
  await db.query(
    `update account set timezone = 'Asia/Tokyo' where account_id = $1`,
    [a],
  );
  const later = await grantStamps(
    db,
    a,
    [{ stamp_id: "cheerleader", level: 3 }],
    { now },
  );
  assert.deepEqual(
    later.granted.map((g) => [g.level, g.earned_on]),
    [[3, "2026-11-15"]],
  );
  const { rows } = await db.query(
    `select level, to_char(earned_on, 'YYYY-MM-DD') as d, definition_version
       from account_stamp_earned where account_id = $1 order by level`,
    [a],
  );
  assert.deepEqual(
    rows.map((r) => [r.level, r.d, r.definition_version]),
    [
      [1, "2026-11-14", 1],
      [2, "2026-11-14", 1],
      [3, "2026-11-15", 1],
    ],
  );
  await assert.rejects(
    grantStamps(db, a, [{ stamp_id: "cheerleader", level: 4 }], { now }),
    TypeError,
  );
  await assert.rejects(
    grantStamps(db, a, [{ stamp_id: "five_wins", level: 1 }], { now }),
    TypeError,
  );
  await assert.rejects(
    grantStamps(db, a, [{ stamp_id: "linked", level: 1 }], {}),
    TypeError,
  );
});

test("concurrent grants insert each level once", async () => {
  const a = await person();
  const now = "2026-11-14T12:00:00Z";
  const asks = Array.from(
    { length: 6 },
    () => (c) =>
      grantStamps(
        c,
        a,
        [
          { stamp_id: "storyteller", level: 3 },
          { stamp_id: "player_verified", level: 1 },
        ],
        { now },
      ),
  );
  const results = await lanes(asks);
  const granted = results.flatMap((r) => r.granted);
  assert.equal(granted.length, 4);
  assert.equal(
    await count(
      `select count(*)::int as n from account_stamp_earned where account_id = $1`,
      [a],
    ),
    4,
  );
});

test("an agent is refused a grant and a fact", async () => {
  const owner = await person();
  const agent = await agentOf(owner);
  const now = "2026-11-14T12:00:00Z";
  assert.deepEqual(
    await grantStamps(db, agent, [{ stamp_id: "linked", level: 1 }], { now }),
    { refused: "not_person" },
  );
  assert.deepEqual(
    await recordFact(
      db,
      agent,
      { stamp_id: "cheerleader", source: "cheer:1", event_at: now },
      { now },
    ),
    { refused: "not_person" },
  );
});

test("a day fact: once per source, once per day, frozen across a zone change", async () => {
  const a = await person({ timezone: "America/Chicago" });
  const now = "2026-11-20T00:00:00Z";
  const cheer = (source, at) =>
    recordFact(
      db,
      a,
      { stamp_id: "cheerleader", source, event_at: at },
      { now },
    );
  // 23:30 Chicago on the 14th.
  const first = await cheer("cheer:a", "2026-11-15T05:30:00Z");
  assert.deepEqual(first, { accepted: true, count: 1, level: 0 });
  // Retry of the same cheer.
  assert.equal(
    (await cheer("cheer:a", "2026-11-15T05:30:00Z")).reason,
    "duplicate_source",
  );
  // Another cheer, same Chicago day (an emoji change, a repeat tap).
  assert.equal(
    (await cheer("cheer:b", "2026-11-14T15:00:00Z")).reason,
    "same_day",
  );
  // The person moves to Tokyo. In Tokyo 05:45Z on the 15th is the 15th,
  // but it falls inside the Chicago day already recorded: same day.
  await db.query(
    `update account set timezone = 'Asia/Tokyo' where account_id = $1`,
    [a],
  );
  assert.equal(
    (await cheer("cheer:c", "2026-11-15T05:45:00Z")).reason,
    "same_day",
  );
  // And the first cheer replayed after the move is still the same event.
  assert.equal(
    (await cheer("cheer:a", "2026-11-15T05:30:00Z")).reason,
    "duplicate_source",
  );
  // A new instant past the recorded day: a new Tokyo day.
  const next = await cheer("cheer:d", "2026-11-16T01:00:00Z");
  assert.deepEqual(next, { accepted: true, count: 2, level: 0 });
  // A date from the future is refused; nothing trusts a client date.
  assert.equal(
    (await cheer("cheer:e", "2026-11-21T00:00:00Z")).reason,
    "future",
  );
  const { rows } = await db.query(
    `select qualifier, to_char(local_day, 'YYYY-MM-DD') as d, source_hash
       from account_stamp_fact where account_id = $1 order by event_at`,
    [a],
  );
  assert.deepEqual(
    rows.map((r) => [r.qualifier, r.d]),
    [
      ["day:2026-11-14", "2026-11-14"],
      ["day:2026-11-16", "2026-11-16"],
    ],
  );
  // Digests and dates only: no source identity in clear.
  for (const r of rows) {
    assert.match(r.source_hash, /^[0-9a-f]{64}$/);
    assert.doesNotMatch(r.source_hash, /cheer/);
  }
});

test("lifetime progress crosses the record's one-year retention and late arrivals", async () => {
  const a = await person();
  const now = "2026-11-14T12:00:00Z";
  // A day well over a year ago still counts; a late-arriving older event
  // after a newer one counts once.
  for (const [source, at] of [
    ["battle:old", "2025-09-01T12:00:00Z"],
    ["battle:new", "2026-11-13T12:00:00Z"],
    ["battle:late", "2026-10-02T12:00:00Z"],
  ])
    assert.equal(
      (
        await recordFact(
          db,
          a,
          { stamp_id: "played_together", source, event_at: at },
          { now },
        )
      ).accepted,
      true,
    );
  const snap = await readSnapshot(db, a, { now });
  assert.equal(snap.facts.played_together, 3);
  const ev = evaluatePassport(snap, now);
  assert.deepEqual(
    ev.grants.filter((g) => g.stamp_id === "played_together"),
    [{ stamp_id: "played_together", level: 1 }],
  );
});

test("Storyteller: one battle once, however it is reposted", async () => {
  const a = await person();
  const now = "2026-11-14T12:00:00Z";
  const story = (source, battle) =>
    recordFact(
      db,
      a,
      {
        stamp_id: "storyteller",
        source,
        event_at: "2026-11-14T10:00:00Z",
        battle_id: battle,
      },
      { now },
    );
  // A highlight counted before 0292, under its old source.
  assert.equal((await story("highlight:1", "battle-x")).accepted, true);
  // The post it became, or one removed and reposted: the same battle.
  assert.equal((await story("post:2", "battle-x")).reason, "same_battle");
  assert.equal((await story("post:3", "battle-y")).count, 2);
  await assert.rejects(story("post:4", ""), TypeError);
  const { rows } = await db.query(
    `select qualifier from account_stamp_fact where account_id = $1`,
    [a],
  );
  for (const r of rows) assert.match(r.qualifier, /^battle:[0-9a-f]{64}$/);
});

test("the cap holds under concurrency: 50 Cheerleader days at most", async () => {
  const a = await person();
  const now = "2027-06-01T00:00:00Z";
  const base = Date.parse("2026-11-01T12:00:00Z");
  const day = (i) => new Date(base + i * 86400e3).toISOString();
  const asks = Array.from(
    { length: 70 },
    (_, i) => (c) =>
      recordFact(
        c,
        a,
        { stamp_id: "cheerleader", source: `cheer:${i}`, event_at: day(i) },
        { now },
      ),
  );
  const results = await lanes(asks);
  assert.equal(results.filter((r) => r.accepted).length, 50);
  assert.ok(results.some((r) => r.reason === "capped"));
  assert.equal(
    await count(
      `select count(*)::int as n from account_stamp_fact where account_id = $1`,
      [a],
    ),
    50,
  );
  await assert.rejects(
    recordFact(
      db,
      a,
      { stamp_id: "linked", source: "x", event_at: now },
      { now },
    ),
    TypeError,
  );
});

test("the profile list is dismissed only after the older welcome, once, completing nothing", async () => {
  const a = await person();
  const t1 = "2026-11-14T10:00:00Z";
  const t2 = "2026-11-14T12:00:00Z";
  // Not offered: the older welcome list was never finished.
  assert.deepEqual(await dismissProfileList(db, a, { now: t1 }), {
    refused: "not_offered",
  });
  await db.query(
    `update account set welcome_finished_at = now() where account_id = $1`,
    [a],
  );
  assert.deepEqual(await dismissProfileList(db, a, { now: t1 }), {
    dismissed_at: new Date(t1).toISOString(),
  });
  // Set once: a second dismissal keeps the first instant.
  assert.deepEqual(await dismissProfileList(db, a, { now: t2 }), {
    dismissed_at: new Date(t1).toISOString(),
  });
  const owner = await readOwnerPassport(db, a, { now: t2 });
  assert.equal(owner.owner.profile.dismissed_at, new Date(t1).toISOString());
  assert.equal(owner.owner.profile.older_welcome_finished, true);
  assert.equal(owner.owner.profile.complete, false, "dismissed is not done");
  assert.equal(owner.owner.profile.completed_at, null);
  assert.ok(owner.owner.profile.steps.every((s) => !s.latched));
  assert.equal(
    owner.owner.stamps.find((s) => s.stamp_id === "all_set").earned_level,
    0,
  );
  const agent = await agentOf(a);
  assert.deepEqual(await dismissProfileList(db, agent, { now: t1 }), {
    refused: "not_person",
  });
});

test("profile latches keep their first instant; choices keep the latest", async () => {
  const a = await person();
  await db.query(
    `update account set welcome_finished_at = now() where account_id = $1`,
    [a],
  );
  const t1 = "2026-11-14T10:00:00Z";
  const t2 = "2026-11-14T11:00:00Z";
  assert.deepEqual(
    await latchProfile(
      db,
      a,
      { steps: ["picture"], digest_choice: "off" },
      { now: t1 },
    ),
    {
      list_version: 2,
      digest_choice: "off",
      map_choice: null,
      place_saved: false,
      complete: false,
    },
  );
  await latchProfile(
    db,
    a,
    { digest_choice: "daily", map_choice: "not_now" },
    { now: t2 },
  );
  await latchProfile(
    db,
    a,
    { map_choice: "place", place_saved: true, complete: true },
    { now: t2 },
  );
  const {
    rows: [row],
  } = await db.query(
    `select l.picture_at, l.digest_at, l.digest_choice, l.map_choice, l.map_at,
            l.map_place_saved_at, l.completed_at, a.welcome_finished_at
       from account_profile_list l join account a using (account_id)
      where l.account_id = $1`,
    [a],
  );
  assert.equal(row.picture_at.toISOString(), new Date(t1).toISOString());
  assert.equal(row.digest_at.toISOString(), new Date(t1).toISOString());
  assert.equal(row.digest_choice, "daily");
  assert.equal(row.map_choice, "place");
  assert.equal(row.map_at.toISOString(), new Date(t2).toISOString());
  assert.ok(row.map_place_saved_at);
  assert.ok(row.completed_at);
  assert.ok(row.welcome_finished_at, "the older welcome marker stays");
  await assert.rejects(
    latchProfile(db, a, { steps: ["wins"] }, { now: t1 }),
    TypeError,
  );
  await assert.rejects(
    latchProfile(db, a, { map_choice: "city" }, { now: t1 }),
    TypeError,
  );
  const agent = await agentOf(a);
  assert.equal(
    await latchProfile(db, agent, { steps: ["picture"] }, { now: t1 }),
    null,
  );
});

test("the snapshot: claims, follows with known and unknown activity, mutuals", async () => {
  const me = await person();
  await claim(me, OWN, "primary", true);
  await claim(me, ALT, "alt");
  await claim(me, FIXTURE_PLAYER, "friend");
  await claim(me, QUIET, "friend");
  await claim(me, UNREAD, "friend");
  // QUIET's battle log was read an hour before now, with no battles.
  const now = "2026-09-04T00:00:00Z";
  await db.query(
    `insert into poll_state (subject_tag, endpoint, last_admitted_at)
     values ($1, 'player_battlelog', '2026-09-03T23:00:00Z')`,
    [QUIET],
  );
  // Someone I follow (BACK, verified by them) follows my verified player.
  const them = await person();
  await claim(them, BACK, "primary", true);
  await claim(them, OWN, "friend");
  await claim(me, BACK, "friend");
  // Someone who follows me but whom I do not follow: not mutual.
  const fan = await person();
  await claim(fan, OWN, "friend");
  await db.query(
    `insert into account_email_pref (account_id, kind, enabled, via)
     values ($1, 'tracking_report', false, 'profile')`,
    [me],
  );
  const snap = await readSnapshot(db, me, { now });
  assert.equal(snap.person, true);
  assert.deepEqual(snap.primary, { verified: true });
  assert.equal(snap.own_verified, true);
  assert.equal(snap.has_alt, true);
  assert.equal(snap.digest_choice, "off");
  assert.equal(snap.mutual_count, 1);
  assert.equal(snap.follows.length, 4);
  const ev = evaluatePassport(snap, now);
  const ic = ev.stamps.find((s) => s.stamp_id === "inner_circle").progress;
  // FIXTURE_PLAYER played on the 3rd: active. QUIET: known inactive.
  // UNREAD and BACK were never read: pending, not inactive.
  assert.deepEqual(ic, {
    count: 1,
    next: 5,
    top: 5,
    unknown: true,
    pending: 2,
  });
  assert.equal(
    ev.profile.steps.find((s) => s.id === "follow_active").state,
    "done",
  );
  assert.deepEqual(ev.grants.map((g) => g.stamp_id).sort(), [
    "full_roster",
    "mutual",
    "player_verified",
  ]);
  // An operator's pref row is not the person's choice.
  await db.query(
    `update account_email_pref set via = 'ops' where account_id = $1`,
    [me],
  );
  assert.equal((await readSnapshot(db, me, { now })).digest_choice, null);
});

test("the owner read ensures only the owner's passport and never grants", async () => {
  const me = await person();
  await claim(me, "#0C2C8", "primary").catch(async () => {
    await db.query(
      `insert into player (player_tag, name) values ('#0C2C8', 'Invented New')`,
    );
    await claim(me, "#0C2C8", "primary");
  });
  await db.query(
    `update account set avatar_card_id = 26000000 where account_id = $1`,
    [me],
  );
  const now = "2026-11-14T12:00:00Z";
  const owner = await readOwnerPassport(db, me, { now });
  assert.match(owner.passport.id, PASSPORT_ID);
  assert.equal(owner.passport.display_name, "Invented New");
  // Unverified: a claim, without the picture.
  assert.deepEqual(owner.passport.player, {
    tag: "#0C2C8",
    name: "Invented New",
    verified: false,
    avatar_card_id: null,
  });
  assert.deepEqual(owner.passport.earned, []);
  // Looking Good is eligible, yet nothing was granted by reading.
  assert.equal(
    await count(
      `select count(*)::int as n from account_stamp_earned where account_id = $1`,
      [me],
    ),
    0,
  );
  const lg = owner.owner.stamps.find((s) => s.stamp_id === "looking_good");
  assert.deepEqual(lg, {
    stamp_id: "looking_good",
    earned_level: 0,
    progress: { count: 1, next: null, top: 1, unknown: false },
  });
  assert.deepEqual(
    owner.owner.profile.steps.map((s) => [s.id, s.state]),
    [
      ["add_player", "done"],
      ["verify_player", "todo"],
      ["picture", "done"],
      ["follow_active", "todo"],
      ["digest", "todo"],
      ["map", "todo"],
    ],
  );
});

test("the public read: by id only, approved persons only, and writes nothing", async () => {
  const a = await person();
  const { passport_id } = await ensurePassport(db, a);
  await grantStamps(db, a, [{ stamp_id: "linked", level: 1 }], {
    now: "2026-11-14T12:00:00Z",
  });
  const tables = [
    "account_passport",
    "account_stamp_earned",
    "account_stamp_fact",
    "account_profile_list",
  ];
  const sizes = async () => {
    const out = {};
    for (const t of tables)
      out[t] = await count(`select count(*)::int as n from ${t}`);
    return out;
  };
  const before = await sizes();
  const pub = await readPublicPassport(db, passport_id);
  assert.deepEqual(pub, {
    passport: {
      id: passport_id,
      display_name: "New player",
      player: null,
      earned: [
        {
          stamp_id: "linked",
          level: 1,
          earned_on: "2026-11-14",
          earned_before: null,
        },
      ],
    },
    catalog_version: 1,
  });
  assert.equal(await readPublicPassport(db, "nopenopenope"), null);
  assert.equal(await readPublicPassport(db, "'; drop table x"), null);
  assert.equal(await readPublicPassport(db, a), null, "never by account id");
  assert.deepEqual(await sizes(), before);
  await db.query(
    `update account set status = 'disabled' where account_id = $1`,
    [a],
  );
  assert.equal(await readPublicPassport(db, passport_id), null);
});

test("deleting an account cascades through all four tables", async () => {
  const a = await person();
  const now = "2026-11-14T12:00:00Z";
  await grantStamps(db, a, [{ stamp_id: "linked", level: 1 }], { now });
  await recordFact(
    db,
    a,
    { stamp_id: "cheerleader", source: "cheer:z", event_at: now },
    { now },
  );
  await latchProfile(db, a, { steps: ["picture"] }, { now });
  await db.query(`delete from account where account_id = $1`, [a]);
  for (const t of [
    "account_passport",
    "account_stamp_earned",
    "account_stamp_fact",
    "account_profile_list",
  ])
    assert.equal(
      await count(`select count(*)::int as n from ${t} where account_id = $1`, [
        a,
      ]),
      0,
      t,
    );
});
