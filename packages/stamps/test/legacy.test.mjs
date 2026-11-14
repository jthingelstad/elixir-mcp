/**
 * The launch line and the legacy backfill (#1015, migration 0272)
 * against a real PostgreSQL scratch database: what an account earned
 * before launch is filed as "Earned before <launch day>", never as an
 * ordinary grant (a bell line), whichever runs first; what it does after
 * launch is ordinary. Every tag here is invented (docs/invented-tags.json).
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
import { backfillAccount, nested } from "../src/backfill.mjs";
import { earnFact, reconcilePassport, settlePassport } from "../src/earn.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_legacy_${process.pid}`;
const URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

// fixtures/player_battlelog/counterpart_2v2_teammate.json is ME's log:
// one-against-one friendlies with RIVAL on 07-10, 08-05, 08-17 and 08-22
// (three games), and two-against-twos with MATE as the teammate on 08-16
// and 08-28.
const ME = "#0YRQJGCJL";
const MATE = "#0990UQVG";
const RIVAL = "#0GC9P98LQ";

const LAUNCH = "2026-09-01T00:00:00.000Z";
const BEFORE = "2026-07-02T00:00:00Z";
const AFTER = "2026-09-05T12:00:00Z";
const NOW = "2026-09-10T00:00:00Z";

let db;
let seq = 0;
let gateway;
let cardId;
let told = 0;

async function person({ created = BEFORE } = {}) {
  seq += 1;
  const {
    rows: [a],
  } = await db.query(
    `insert into account (email_hash, status, role, created_at)
     values ($1, 'approved', 'member', $2) returning account_id`,
    [`legacy-${seq}`, created],
  );
  return a.account_id;
}

/** A claim made at `made`, verified at `verified` when given; a verified
 *  one first releases the tag from an earlier test's account. */
async function claim(accountId, tag, rel, { made = BEFORE, verified } = {}) {
  if (verified)
    await db.query(
      `update claim set status = 'unverified', verified_at = null
        where player_tag = $1 and status = 'verified'`,
      [tag],
    );
  await db.query(
    `insert into claim (account_id, player_tag, is_primary, relationship,
                        status, verified_at, created_at)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      accountId,
      tag,
      rel === "primary",
      rel,
      verified ? "verified" : "unverified",
      verified ?? null,
      made,
    ],
  );
}

const earned = async (id) =>
  (
    await db.query(
      `select stamp_id, level, earned_on::text as earned_on,
              legacy_before::text as legacy_before
         from account_stamp_earned where account_id = $1
        order by stamp_id, level`,
      [id],
    )
  ).rows;
const count = async (sql, params) => (await db.query(sql, params)).rows[0].n;
const facts = (id, stamp) =>
  count(
    `select count(*)::int as n from account_stamp_fact
      where account_id = $1 and stamp_id = $2`,
    [id, stamp],
  );
const ids = (rows) => rows.map((g) => `${g.stamp_id}:${g.level}`).sort();

async function highlight(accountId, at) {
  const {
    rows: [b],
  } = await db.query(
    `select battle_id from battle_participant where player_tag = $1
      order by battle_time offset $2 limit 1`,
    [ME, told++],
  );
  const {
    rows: [h],
  } = await db.query(
    `insert into battle_highlight (player_tag, battle_id, account_id, words,
                                   created_at)
     values ($1, $2, $3, 'Close one.', $4)
     returning highlight_id::text, battle_id, created_at`,
    [ME, b.battle_id, accountId, at],
  );
  return h;
}

before(async () => {
  await createScratch(NAME);
  db = new pg.Client({ connectionString: URL });
  await db.connect();
  await db.query(`update passport_launch set launched_at = $1`, [LAUNCH]);
  for (const tag of [ME, MATE, RIVAL])
    await db.query(`insert into player (player_tag) values ($1)`, [tag]);
  const operator = await person();
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by)
     values ('player', $1, $2)`,
    [ME, operator],
  );
  const {
    rows: [gw],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'legacy-gw', '127.0.0.1', 'active') returning gateway_id`,
    [operator],
  );
  gateway = gw.gateway_id;
  for (const [endpoint, entity, file, at] of [
    ["cards", "GLOBAL", "cards/catalog.json", "2026-08-01T00:00:00Z"],
    [
      "player_battlelog",
      ME,
      "player_battlelog/counterpart_2v2_teammate.json",
      "2026-08-29T00:00:00Z",
    ],
  ]) {
    const body = await readFile(path.join(repoRoot, "fixtures", file), "utf8");
    const r = await processResult(db, {
      v: 1,
      job: { endpoint, entity_key: entity, lane: "bulk" },
      gateway_id: gateway,
      fetched_at: at,
      status: "ok",
      body_gzip_b64: gzipSync(Buffer.from(body)).toString("base64"),
    });
    assert.equal(r.outcome, "admitted", JSON.stringify(r));
  }
  cardId = (await db.query(`select card_id from card limit 1`)).rows[0].card_id;
});

after(async () => {
  await db?.end();
  await dropScratch(NAME);
});

test("a pre-launch account's first settle files what stood at launch as legacy; what it does after is ordinary", async () => {
  const me = await person();
  await claim(me, ME, "primary", { verified: BEFORE });
  await claim(me, RIVAL, "friend");
  await db.query(
    `update account set avatar_card_id = $2, avatar_set_at = $3
      where account_id = $1`,
    [me, cardId, BEFORE],
  );
  const first = await settlePassport(db, me, { now: NOW });
  assert.deepEqual(first.granted, []);
  assert.deepEqual(ids(first.legacy), ["looking_good:1", "player_verified:1"]);
  for (const row of await earned(me)) {
    assert.equal(row.earned_on, null);
    assert.equal(row.legacy_before, "2026-09-01");
  }
  // A highlight written before launch, counted now: legacy, no line.
  const h = await highlight(me, "2026-08-20T00:00:00Z");
  const told = await earnFact(
    db,
    me,
    {
      stamp_id: "storyteller",
      source: `highlight:${h.highlight_id}`,
      battle_id: h.battle_id,
      event_at: h.created_at,
    },
    { now: NOW },
  );
  assert.deepEqual(told.granted, []);
  assert.deepEqual(ids(told.legacy), ["storyteller:1"]);
  // Reconciliation (Played Together from the friendlies of its 30 days,
  // 08-17 and 08-22) adds no line either.
  const rec = await reconcilePassport(db, me, { now: NOW });
  assert.deepEqual(rec.granted, []);
  assert.equal(await facts(me, "played_together"), 2);
  // After launch: an alt, verified now. One ordinary grant.
  await claim(me, MATE, "alt", { made: AFTER, verified: AFTER });
  const later = await settlePassport(db, me, { now: NOW });
  assert.deepEqual(ids(later.granted), ["full_roster:1"]);
  assert.deepEqual(later.legacy, []);
  const roster = (await earned(me)).find((r) => r.stamp_id === "full_roster");
  assert.equal(roster.legacy_before, null);
  assert.ok(roster.earned_on);
  // The baseline is settled once.
  const again = await settlePassport(db, me, { now: NOW });
  assert.deepEqual(again, { granted: [], legacy: [] });
});

test("a verification made after launch is a line even as the account's first earning call", async () => {
  const me = await person();
  await claim(me, ME, "primary", { verified: AFTER });
  const out = await settlePassport(db, me, { now: NOW });
  assert.deepEqual(ids(out.granted), ["player_verified:1"]);
  assert.deepEqual(out.legacy, []);
});

test("ladders: a level pre-launch facts reach is legacy; one a later fact completes is ordinary", async () => {
  const old = await person();
  const mixed = await person();
  const cheer = (id, day) =>
    earnFact(
      db,
      id,
      {
        stamp_id: "cheerleader",
        source: `cheer:${id}-${day}`,
        event_at: day,
      },
      { now: NOW },
    );
  for (const day of [
    "2026-08-03T10:00:00Z",
    "2026-08-04T10:00:00Z",
    "2026-08-05T10:00:00Z",
  ])
    await cheer(old, day);
  assert.deepEqual(ids((await earned(old)).filter((r) => r.legacy_before)), [
    "cheerleader:1",
  ]);
  await cheer(mixed, "2026-08-03T10:00:00Z");
  await cheer(mixed, "2026-08-04T10:00:00Z");
  // A post-launch fact completes the level, but the account's history
  // before launch is not read yet: the level waits rather than become a
  // line that history might have made legacy (0273).
  const third = await cheer(mixed, AFTER);
  assert.deepEqual(third.granted, []);
  assert.deepEqual(third.legacy, []);
  assert.deepEqual(await earned(mixed), []);
  // The backfill reads it (here: nothing more before launch), then the
  // account's next earning call grants the level as ordinary, one line.
  await db.query("begin");
  const r = await backfillAccount(db, mixed, { now: NOW });
  await db.query("commit");
  assert.deepEqual(r.legacy, []);
  const next = await settlePassport(db, mixed, { now: NOW });
  assert.deepEqual(ids(next.granted), ["cheerleader:1"]);
});

test("history the backfill reads first makes a level legacy that a post-launch fact would otherwise have made a line", async () => {
  const me = await person();
  const cheer = (day) =>
    earnFact(
      db,
      me,
      { stamp_id: "cheerleader", source: `cheer:h-${day}`, event_at: day },
      { now: NOW },
    );
  // Two post-launch cheers and one more: three facts, level 1 reachable,
  // but it waits for the history.
  await cheer("2026-09-02T10:00:00Z");
  await cheer("2026-09-03T10:00:00Z");
  assert.deepEqual((await cheer(AFTER)).granted, []);
  // The backfill finds three cheers from before launch.
  await db.query("begin");
  const r = await backfillAccount(db, me, {
    now: NOW,
    cheers: [
      { source: "cheer:h-old-1", event_at: "2026-08-03T10:00:00Z" },
      { source: "cheer:h-old-2", event_at: "2026-08-04T10:00:00Z" },
      { source: "cheer:h-old-3", event_at: "2026-08-05T10:00:00Z" },
    ],
  });
  await db.query("commit");
  assert.deepEqual(ids(r.legacy), ["cheerleader:1"]);
  // Nothing old is ever a line; the next call has nothing new to grant
  // (six facts: still level 1).
  assert.deepEqual((await settlePassport(db, me, { now: NOW })).granted, []);
  assert.deepEqual(
    (await earned(me)).map((e) => [e.stamp_id, e.level, e.legacy_before]),
    [["cheerleader", 1, "2026-09-01"]],
  );
});

test("an account made before launch but approved after it has no history to wait for: its ladder levels are ordinary", async () => {
  // Requested before launch (it could not sign in), approved after it.
  const late = await person();
  await db.query(
    `update account set decided_at = $2 where account_id = $1::uuid`,
    [late, "2026-09-02T00:00:00Z"],
  );
  const cheer = (day) =>
    earnFact(
      db,
      late,
      { stamp_id: "cheerleader", source: `cheer:ap-${day}`, event_at: day },
      { now: NOW },
    );
  await cheer("2026-09-03T10:00:00Z");
  await cheer("2026-09-04T10:00:00Z");
  const third = await cheer(AFTER);
  assert.deepEqual(ids(third.granted), ["cheerleader:1"]);
  assert.deepEqual(
    (await earned(late)).map((e) => [e.stamp_id, e.level, e.legacy_before]),
    [["cheerleader", 1, null]],
  );
});

test("an account made after launch: the backfill skips it and its grants are ordinary", async () => {
  const me = await person({ created: AFTER });
  await claim(me, ME, "primary", { made: AFTER, verified: AFTER });
  await db.query("begin");
  const r = await backfillAccount(db, me, { now: NOW });
  await db.query("rollback");
  assert.deepEqual(r, { skipped: "after_launch" });
  const out = await settlePassport(db, me, { now: NOW });
  assert.deepEqual(ids(out.granted), ["player_verified:1"]);
});

test("the backfill: a dry run writes nothing and reports what an apply writes; a second apply grants nothing", async () => {
  const me = await person();
  await claim(me, ME, "primary", { verified: BEFORE });
  await claim(me, RIVAL, "friend");
  await highlight(me, "2026-08-20T00:00:00Z");
  const cheers = [
    { source: "cheer:9001", event_at: "2026-08-03T10:00:00Z" },
    { source: "cheer:9002", event_at: "2026-08-04T10:00:00Z" },
    { source: "cheer:9003", event_at: "2026-08-05T10:00:00Z" },
    // Given after launch: never backfilled.
    { source: "cheer:9004", event_at: AFTER },
  ];
  const run = async (apply) => {
    await db.query("begin");
    try {
      const r = await backfillAccount(db, me, { now: NOW, cheers });
      await db.query(apply ? "commit" : "rollback");
      return r;
    } catch (err) {
      await db.query("rollback");
      throw err;
    }
  };
  const dry = await run(false);
  assert.deepEqual(await earned(me), []);
  assert.equal(
    await count(
      `select count(*)::int as n from account_stamp_fact where account_id = $1`,
      [me],
    ),
    0,
  );
  const applied = await run(true);
  assert.deepEqual(applied, dry);
  assert.equal(applied.setup_settled, true);
  assert.deepEqual(applied.facts, {
    storyteller: 1,
    cheerleader: 3,
    // The year before launch: 07-10, 08-05, 08-17 and 08-22.
    played_together: 4,
  });
  assert.deepEqual(ids(applied.legacy), [
    "cheerleader:1",
    "played_together:1",
    "player_verified:1",
    "storyteller:1",
  ]);
  for (const row of await earned(me))
    assert.equal(row.legacy_before, "2026-09-01");
  const second = await run(true);
  assert.deepEqual(second, {
    setup_settled: false,
    legacy: [],
    facts: { storyteller: 0, cheerleader: 0, played_together: 0 },
  });
  // The account's own first visit after it: nothing new to tell.
  assert.deepEqual((await settlePassport(db, me, { now: NOW })).granted, []);
  assert.deepEqual((await reconcilePassport(db, me, { now: NOW })).granted, []);
});

test("nested: a failing statement in the account's transaction undoes only itself", async () => {
  await db.query("begin");
  try {
    const tx = nested(db);
    await tx.query(`create temp table nest_probe (n int) on commit drop`);
    await tx.query(`insert into nest_probe values (1)`);
    await assert.rejects(tx.query(`select 1 / 0`), /division by zero/);
    await tx.query("begin");
    await tx.query(`insert into nest_probe values (2)`);
    await tx.query("rollback");
    await tx.query("begin");
    await tx.query(`insert into nest_probe values (3)`);
    await tx.query("commit");
    const { rows } = await tx.query(`select n from nest_probe order by n`);
    assert.deepEqual(
      rows.map((r) => r.n),
      [1, 3],
    );
  } finally {
    await db.query("rollback");
  }
});
