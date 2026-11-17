/**
 * Earning (#1015) against a real PostgreSQL scratch database: the
 * settle after a setup write, ladder facts with their grants, and the
 * owner's bounded reconciliation (Played Together by ingestion
 * checkpoint, Storyteller from highlights). Real battles come through the
 * ingest pipeline from the fixtures; every tag here is invented
 * (docs/invented-tags.json).
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
  RECONCILE,
  earnFact,
  reconcilePassport,
  rewindPlayed,
  settlePassport,
} from "../src/earn.mjs";
import { ensurePassport, readOwnerPassport } from "../src/store.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_earn_${process.pid}`;
const URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

// fixtures/player_battlelog/counterpart_2v2_teammate.json is ME's log:
// one-against-one friendlies with RIVAL (08-05, 08-17, 08-22 three
// times) and OTHER, and two clanMate2v2 battles (08-16, 08-28) where MATE
// is ME's teammate and RIVAL and OTHER are the opponents.
const ME = "#0YRQJGCJL";
const MATE = "#0990UQVG";
const RIVAL = "#0GC9P98LQ";
const OTHER = "#0GQ2CLQQJ";
// fixtures/player_battlelog/with_clanmate_2v2.json is MATE's log: among
// others fourteen friendlies with LATE on 2026-09-02.
const LATE = "#090QRQGJ22";
const SPARE = "#0PYLQ2";

let db;
let seq = 0;
let operator;
let gateway;

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

async function person({ timezone = "UTC" } = {}) {
  seq += 1;
  const {
    rows: [a],
  } = await db.query(
    `insert into account (email_hash, status, role, timezone)
     values ($1, 'approved', 'member', $2) returning account_id`,
    [`earn-${seq}`, timezone],
  );
  return a.account_id;
}

/** A claim; a verified one first releases the tag from an earlier
 *  test's account (one verified owner per tag). */
async function claim(accountId, tag, rel, verified = false) {
  if (verified)
    await db.query(
      `update claim set status = 'unverified', verified_at = null
        where player_tag = $1 and status = 'verified'`,
      [tag],
    );
  return db.query(
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
}

/** Granted levels as stamp:level, for asserting. */
const got = (granted, stamp) =>
  granted.filter((g) => g.stamp_id === stamp).map((g) => g.level);

const n = async (sql, params) => (await db.query(sql, params)).rows[0].n;
const facts = (id, stamp) =>
  n(
    `select count(*)::int as n from account_stamp_fact
      where account_id = $1 and stamp_id = $2`,
    [id, stamp],
  );
const levels = async (id, stamp) =>
  (
    await db.query(
      `select level from account_stamp_earned
        where account_id = $1 and stamp_id = $2 order by level`,
      [id, stamp],
    )
  ).rows.map((r) => r.level);

async function ingest(entity, rel, fetchedAt) {
  const payload = JSON.parse(
    await readFile(path.join(repoRoot, "fixtures", rel), "utf8"),
  );
  const result = await processResult(db, {
    v: 1,
    job: { endpoint: "player_battlelog", entity_key: entity, lane: "bulk" },
    gateway_id: gateway,
    fetched_at: fetchedAt,
    status: "ok",
    body_gzip_b64: gzipSync(Buffer.from(JSON.stringify(payload))).toString(
      "base64",
    ),
  });
  assert.equal(result.outcome, "admitted", JSON.stringify(result));
}

/** Every battle recorded so far was recorded long ago: settled. */
const settleRecord = () =>
  db.query(`update battle set created_at = '2026-08-01T00:00:00Z'`);

before(async () => {
  await createScratch(NAME);
  db = new pg.Client({ connectionString: URL });
  await db.connect();
  for (const tag of [ME, MATE, RIVAL, OTHER, LATE, SPARE])
    await db.query(`insert into player (player_tag) values ($1)`, [tag]);
  operator = await person();
  for (const tag of [ME, MATE])
    await db.query(
      `insert into recording (subject_type, subject_tag, requested_by)
       values ('player', $1, $2)`,
      [tag, operator],
    );
  const {
    rows: [gw],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'earn-gw', '127.0.0.1', 'active') returning gateway_id`,
    [operator],
  );
  gateway = gw.gateway_id;
  const cards = JSON.parse(
    await readFile(path.join(repoRoot, "fixtures/cards/catalog.json"), "utf8"),
  );
  const r = await processResult(db, {
    v: 1,
    job: { endpoint: "cards", entity_key: "GLOBAL", lane: "bulk" },
    gateway_id: gateway,
    fetched_at: "2026-08-01T00:00:00Z",
    status: "ok",
    body_gzip_b64: gzipSync(Buffer.from(JSON.stringify(cards))).toString(
      "base64",
    ),
  });
  assert.equal(r.outcome, "admitted");
  await ingest(
    ME,
    "player_battlelog/counterpart_2v2_teammate.json",
    "2026-08-29T00:00:00Z",
  );
});

after(async () => {
  await db?.end();
  await dropScratch(NAME);
});

const AUG30 = "2026-08-30T00:00:00Z";

test("Played Together: a 1v1 friend counts, a 2v2 opponent does not, one day once", async () => {
  const me = await person();
  await claim(me, ME, "primary", true);
  await claim(me, RIVAL, "friend");
  const first = await reconcilePassport(db, me, { now: AUG30 });
  // 08-05, 08-17 and 08-22 (three games): three days. The 08-16 and
  // 08-28 two-against-twos have RIVAL as an opponent: not evidence.
  assert.equal(await facts(me, "played_together"), 3);
  assert.deepEqual(got(first.granted, "played_together"), [1]);
  assert.equal(first.more, false);
  const again = await reconcilePassport(db, me, { now: AUG30 });
  assert.deepEqual(again.granted, []);
  assert.equal(await facts(me, "played_together"), 3);
  assert.deepEqual(await levels(me, "played_together"), [1]);
});

test("Played Together: in 2v2 the followed player must be the teammate", async () => {
  const me = await person();
  await claim(me, ME, "primary", true);
  await claim(me, MATE, "friend");
  await reconcilePassport(db, me, { now: AUG30 });
  // 08-16 and 08-28, both with MATE on ME's side.
  assert.equal(await facts(me, "played_together"), 2);
});

test("Played Together: the account's own alt is not a friend, and only verified players are its side", async () => {
  const both = await person();
  await claim(both, ME, "primary", true);
  await claim(both, MATE, "alt", true);
  await reconcilePassport(db, both, { now: AUG30 });
  assert.equal(await facts(both, "played_together"), 0);
  // Unverified, the player is not yet the account's side.
  const unproven = await person();
  await claim(unproven, ME, "primary", false);
  await claim(unproven, RIVAL, "friend");
  await reconcilePassport(db, unproven, { now: AUG30 });
  assert.equal(await facts(unproven, "played_together"), 0);
});

test("Played Together: the checkpoint moves past settled battles; a new follow rewinds it", async () => {
  await settleRecord();
  const me = await person();
  await claim(me, ME, "primary", true);
  await claim(me, OTHER, "friend");
  await reconcilePassport(db, me, { now: AUG30 });
  // OTHER: 1v1 on 08-16, 08-17, 08-20 (twice), 08-22, 08-28.
  assert.equal(await facts(me, "played_together"), 5);
  const mark = await n(
    `select played_cursor::text as n from account_passport where account_id = $1`,
    [me],
  );
  assert.ok(mark !== null, "the checkpoint moved");
  assert.equal(typeof mark, "string", "bigint arrives as a string");
  // Following MATE afterwards: the battles behind the checkpoint were
  // judged without MATE, so the hook rewinds and the next pass reads the
  // window again; days already held are not counted twice.
  await claim(me, MATE, "friend");
  await rewindPlayed(db, me);
  await reconcilePassport(db, me, { now: AUG30 });
  // MATE adds no new day: 08-16 and 08-28 were already OTHER days.
  assert.equal(await facts(me, "played_together"), 5);
  assert.deepEqual(await levels(me, "played_together"), [1, 2]);
});

test("Played Together: a late record is read once by ingestion, many games in a day are one", async () => {
  const me = await person();
  await claim(me, MATE, "primary", true);
  await claim(me, LATE, "friend");
  const now = "2026-09-03T12:00:00Z";
  await settleRecord();
  await reconcilePassport(db, me, { now });
  assert.equal(await facts(me, "played_together"), 0);
  // MATE's own log arrives later: fourteen friendlies with LATE on 09-02
  // and older battles the record did not have.
  await ingest(
    MATE,
    "player_battlelog/with_clanmate_2v2.json",
    "2026-09-03T11:00:00Z",
  );
  await settleRecord();
  await reconcilePassport(db, me, { now });
  assert.equal(await facts(me, "played_together"), 1);
  await reconcilePassport(db, me, { now });
  assert.equal(await facts(me, "played_together"), 1);
});

test("Played Together: two tabs and a zone change cannot duplicate facts, levels or notices", async () => {
  const me = await person({ timezone: "America/Chicago" });
  await claim(me, ME, "primary", true);
  await claim(me, RIVAL, "friend");
  await ensurePassport(db, me);
  const runs = await lanes(
    Array.from(
      { length: 8 },
      () => (c) => reconcilePassport(c, me, { now: AUG30 }),
    ),
  );
  assert.equal(await facts(me, "played_together"), 3);
  assert.deepEqual(await levels(me, "played_together"), [1]);
  const granted = runs.flatMap((r) =>
    r.granted.filter((g) => g.stamp_id === "played_together"),
  );
  assert.equal(granted.length, 1, "one call reports the new level");
  // One earned row for the level, so the bell has one line.
  assert.equal(
    await n(
      `select count(distinct earned_at)::int as n from account_stamp_earned
        where account_id = $1 and stamp_id = 'played_together'`,
      [me],
    ),
    1,
  );
  // A zone fourteen hours ahead moves 08-22's games to the 23rd's local
  // day; the frozen bounds keep them in the day already counted.
  await db.query(
    `update account set timezone = 'Pacific/Kiritimati' where account_id = $1`,
    [me],
  );
  await rewindPlayed(db, me);
  await reconcilePassport(db, me, { now: AUG30 });
  assert.equal(await facts(me, "played_together"), 3);
});

test("a hook racing reconciliation earns each fact and level once", async () => {
  const me = await person();
  await claim(me, ME, "primary", true);
  await claim(me, RIVAL, "friend");
  await ensurePassport(db, me);
  const fact = {
    stamp_id: "played_together",
    source: "battle:invented-race",
    event_at: "2026-08-24T12:00:00Z",
  };
  await lanes([
    (c) => reconcilePassport(c, me, { now: AUG30 }),
    (c) => earnFact(c, me, fact, { now: AUG30 }),
    (c) => earnFact(c, me, fact, { now: AUG30 }),
    (c) => settlePassport(c, me, { now: AUG30 }),
  ]);
  assert.equal(await facts(me, "played_together"), 4);
  assert.deepEqual(await levels(me, "played_together"), [1]);
});

test("Cheerleader: retries, other emoji and more cheers that day do not multiply; the year boundary does not reset", async () => {
  const me = await person();
  await ensurePassport(db, me);
  const cheer = (item, at, now = at) =>
    earnFact(
      db,
      me,
      { stamp_id: "cheerleader", source: `cheer:${item}`, event_at: at },
      { now },
    );
  // Three days in 2026.
  await cheer("a", "2026-03-01T12:00:00Z");
  await cheer("a", "2026-03-01T12:00:00Z"); // a retry
  await cheer("b", "2026-03-01T15:00:00Z"); // another item, same day
  await cheer("c", "2026-03-02T12:00:00Z");
  const third = await cheer("d", "2026-03-03T12:00:00Z");
  assert.deepEqual(got(third.granted, "cheerleader"), [1]);
  // Twelve more days in 2027, past the record's one-year retention.
  let last;
  for (let d = 1; d <= 12; d += 1) {
    const at = `2027-04-${String(d).padStart(2, "0")}T12:00:00Z`;
    last = await cheer(`y${d}`, at);
  }
  assert.equal(last.count, 15);
  assert.deepEqual(got(last.granted, "cheerleader"), [2]);
  assert.deepEqual(await levels(me, "cheerleader"), [1, 2]);
});

test("Storyteller: reconciliation reads battle posts with words, once per battle", async () => {
  const me = await person();
  await claim(me, ME, "primary", true);
  const battles = (
    await db.query(
      `select battle_id from battle_participant where player_tag = $1
        order by battle_time limit 3`,
      [ME],
    )
  ).rows.map((r) => r.battle_id);
  // Posts about battles (0291): with words, with none, with words.
  await db.query(
    `insert into account_post (item_id, player_tag, battle_id, account_id, body)
     values ('tl_000000000000000005a1', $1, $2, $5, 'Close one.'),
            ('tl_000000000000000005a2', $1, $3, $5, ''),
            ('tl_000000000000000005a3', $1, $4, $5, 'Again!')`,
    [ME, ...battles, me],
  );
  // The first was a highlight, counted by the hook before 0291 under its
  // old source: reconciliation reads it as a post now, and the battle
  // qualifier keeps it from counting twice. It adds the third.
  const [{ created_at }] = (
    await db.query(
      `select created_at from account_post
        where account_id = $1 and battle_id = $2`,
      [me, battles[0]],
    )
  ).rows;
  await earnFact(
    db,
    me,
    {
      stamp_id: "storyteller",
      source: "highlight:00000000-0000-4000-8000-0000000005a1",
      battle_id: battles[0],
      event_at: created_at,
    },
    { now: new Date() },
  );
  const out = await reconcilePassport(db, me, { now: new Date() });
  assert.equal(await facts(me, "storyteller"), 2);
  assert.deepEqual(await levels(me, "storyteller"), [1]);
  assert.ok(!out.granted.some((g) => g.stamp_id === "storyteller"));
  await reconcilePassport(db, me, { now: new Date() });
  assert.equal(await facts(me, "storyteller"), 2);
});

test("setup: All Set needs a verified primary; Off and Not now count; completion stays", async () => {
  const me = await person();
  await claim(me, SPARE, "primary", false);
  await db.query(
    `update account set avatar_card_id = 26000000 where account_id = $1`,
    [me],
  );
  await claim(me, RIVAL, "friend");
  await db.query(
    `insert into poll_state (subject_tag, endpoint, last_admitted_at)
     values ($1, 'player_battlelog', '2026-08-29T00:00:00Z')
     on conflict do nothing`,
    [RIVAL],
  );
  await settlePassport(db, me, {
    now: AUG30,
    latch: { digest_choice: "off" },
  });
  await settlePassport(db, me, {
    now: AUG30,
    latch: { map_choice: "not_now" },
  });
  // Unverified primary: five steps, no All Set.
  assert.deepEqual(await levels(me, "all_set"), []);
  assert.deepEqual(await levels(me, "on_the_map"), [], "Not now is no place");
  await db.query(
    `update claim set status = 'verified', verified_at = now()
      where account_id = $1 and player_tag = $2`,
    [me, SPARE],
  );
  const done = await settlePassport(db, me, { now: AUG30 });
  assert.ok(done.granted.some((g) => g.stamp_id === "all_set"));
  assert.ok(done.granted.some((g) => g.stamp_id === "player_verified"));
  assert.deepEqual(await levels(me, "on_the_map"), []);
  // A revoked proof and a removed picture keep the dated Stamps, and the
  // completed list stays complete.
  await db.query(
    `update claim set status = 'unverified', verified_at = null
      where account_id = $1`,
    [me],
  );
  await db.query(
    `update account set avatar_card_id = null where account_id = $1`,
    [me],
  );
  await settlePassport(db, me, { now: AUG30 });
  assert.deepEqual(await levels(me, "player_verified"), [1]);
  assert.deepEqual(await levels(me, "all_set"), [1]);
  const read = await readOwnerPassport(db, me, { now: AUG30 });
  assert.equal(read.owner.profile.complete, true);
});

test("setup: a saved place grants On the Map and its removal keeps it", async () => {
  const me = await person();
  await ensurePassport(db, me);
  const out = await settlePassport(db, me, {
    now: AUG30,
    latch: { map_choice: "place", place_saved: true },
  });
  assert.deepEqual(got(out.granted, "on_the_map"), [1]);
  // Reconciliation asks Clan only while the save is not latched.
  let asked = 0;
  await reconcilePassport(db, me, {
    now: AUG30,
    placeSaved: async () => {
      asked += 1;
      return false;
    },
  });
  assert.equal(asked, 0);
  assert.deepEqual(await levels(me, "on_the_map"), [1]);
  // The owner read says nothing about where.
  const read = await readOwnerPassport(db, me, { now: AUG30 });
  assert.doesNotMatch(
    JSON.stringify(read),
    /"(lat|lng|lon|latitude|longitude|city|place|point)"/i,
  );
});

test("setup: reconciliation repairs a place save whose hook failed", async () => {
  const me = await person();
  await ensurePassport(db, me);
  const out = await reconcilePassport(db, me, {
    now: AUG30,
    placeSaved: async () => true,
  });
  assert.ok(out.granted.some((g) => g.stamp_id === "on_the_map"));
});

test("the default weekly digest is not a choice; an explicit one is", async () => {
  const me = await person();
  await ensurePassport(db, me);
  await settlePassport(db, me, { now: AUG30 });
  let read = await readOwnerPassport(db, me, { now: AUG30 });
  assert.notEqual(
    read.owner.profile.steps.find((s) => s.id === "digest").state,
    "done",
  );
  await settlePassport(db, me, {
    now: AUG30,
    latch: { digest_choice: "weekly" },
  });
  read = await readOwnerPassport(db, me, { now: AUG30 });
  assert.equal(
    read.owner.profile.steps.find((s) => s.id === "digest").state,
    "done",
  );
});

test("an agent account has nothing to reconcile or settle", async () => {
  const owner = await person();
  const {
    rows: [a],
  } = await db.query(
    `insert into account (status, role, kind, owned_by_account_id)
     values ('approved', 'member', 'agent', $1) returning account_id`,
    [owner],
  );
  assert.equal(await reconcilePassport(db, a.account_id, { now: AUG30 }), null);
  assert.deepEqual(await settlePassport(db, a.account_id, { now: AUG30 }), {
    refused: "not_person",
  });
});

test("wins, trophies and rank are read nowhere in earning", async () => {
  const src = await readFile(path.join(here, "../src/earn.mjs"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(
    code,
    /\b(crowns|trophies|trophy_change|starting_trophies|outcome|winner|league|rank|elo)\b/i,
  );
  assert.ok(RECONCILE.BATTLES > 0 && RECONCILE.FACTS > 0);
});

/** A client whose checkpoint write first lets `meanwhile` run on another
 *  connection: the interleaving where the account's players change after
 *  a pass read its battles and before it moved the checkpoint. */
function rewoundMidPass(meanwhile) {
  return {
    async query(text, params) {
      if (/set played_cursor = greatest/.test(text)) await meanwhile();
      return db.query(text, params);
    },
  };
}

const checkpoint = async (id) =>
  (
    await db.query(
      `select played_cursor::text as cursor, played_epoch
         from account_passport where account_id = $1`,
      [id],
    )
  ).rows[0];

test("a rewind between a pass's read and its checkpoint write wins", async () => {
  await settleRecord();
  const me = await person();
  await claim(me, ME, "primary", true);
  await claim(me, RIVAL, "friend");
  await ensurePassport(db, me);
  const other = new pg.Client({ connectionString: URL });
  await other.connect();
  try {
    await reconcilePassport(
      rewoundMidPass(() => rewindPlayed(other, me)),
      me,
      { now: AUG30 },
    );
  } finally {
    await other.end();
  }
  // The stale pass's facts stay (they were true); its checkpoint did not
  // land, so the next pass reads the window again.
  assert.equal(await facts(me, "played_together"), 3);
  assert.deepEqual(await checkpoint(me), { cursor: null, played_epoch: 1 });
  await claim(me, MATE, "friend");
  await reconcilePassport(db, me, { now: AUG30 });
  // MATE's 08-16 and 08-28 two-against-twos, behind the stale pass's
  // would-be checkpoint, are read: two more days.
  assert.equal(await facts(me, "played_together"), 5);
  const after = await checkpoint(me);
  assert.notEqual(after.cursor, null);
  assert.equal(after.played_epoch, 1);
});

test("a rewind of a null checkpoint still counts the epoch up", async () => {
  await settleRecord();
  const me = await person();
  await claim(me, ME, "primary", true);
  await claim(me, RIVAL, "friend");
  await ensurePassport(db, me);
  assert.deepEqual(await checkpoint(me), { cursor: null, played_epoch: 0 });
  await rewindPlayed(db, me);
  assert.deepEqual(await checkpoint(me), { cursor: null, played_epoch: 1 });
  // A pass that read epoch 1, with another rewind before its checkpoint
  // write, cannot land its checkpoint either.
  const other = new pg.Client({ connectionString: URL });
  await other.connect();
  try {
    await reconcilePassport(
      rewoundMidPass(() => rewindPlayed(other, me)),
      me,
      { now: AUG30 },
    );
  } finally {
    await other.end();
  }
  assert.deepEqual(await checkpoint(me), { cursor: null, played_epoch: 2 });
});
