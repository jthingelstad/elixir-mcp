/**
 * The nightly efficiency row (0145) over a scratch database: polls and
 * what they found, gaps, and the loss measured against the profile's
 * lifetime counter with the no-gap intervals as the noise floor.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { captureEfficiency, efficiencyForDay } from "../src/efficiency.mjs";
import { handler } from "../src/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_efficiency_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

// The day under test is 2026-09-18 (UTC); NOW is the morning after.
const NOW = new Date("2026-09-19T05:20:00Z");
const GAPPED = "#P0P0P0P0"; // one gap; the counter moved 40, 12 captured
const CLEAN = "#P0P0P0P2"; // no gap; the counter moved 20, 19 captured
const OPP = "#P0P0P0P8";

let db, gatewayId;

async function battle(id, at, tag) {
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class)
     values ($1, $2, 'PvP', 'pvp') on conflict do nothing`,
    [id, at],
  );
  await db.query(
    `insert into battle_participant (battle_id, player_tag, side, battle_time, outcome, type, type_class)
     values ($1, $2, 0, $3, 'win', 'PvP', 'pvp'), ($1, $4, 1, $3, 'loss', 'PvP', 'pvp')
     on conflict do nothing`,
    [id, tag, at, OPP],
  );
}

async function snapshot(tag, date, observedAt, battleCount) {
  await db.query(
    `insert into player_snapshot_daily
       (player_tag, snapshot_date, snapshot_kind, observed_at, profile_observed_at, battle_count)
     values ($1, $2, 'daily', $3, $3, $4)`,
    [tag, date, observedAt, battleCount],
  );
}

async function poll(tag, at, { newFacts, observed, filtered, gap = null }) {
  const receipt = (
    await db.query(
      `insert into api_receipt (endpoint, entity_key, fetched_at, payload_hash, gateway_id, admission, new_facts, observed, filtered)
       values ('player_battlelog', $1, $2, $3, $4, 'admitted', $5, $6, $7)
       returning receipt_id`,
      [tag, at, `h-${tag}-${at}`, gatewayId, newFacts, observed, filtered],
    )
  ).rows[0].receipt_id;
  if (gap !== null)
    await db.query(
      `insert into capture_audit (receipt_id, subject_tag, gap, fetched_at)
       values ($1, $2, $3, $4)`,
      [receipt, tag, gap, at],
    );
}

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.query(`create database ${NAME}`);
  await admin.end();
  await migrate({
    databaseUrl: DB_URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  const accountId = (
    await db.query(
      `insert into account (email_hash, status) values ('efficiency-test', 'approved')
       returning account_id`,
    )
  ).rows[0].account_id;
  for (const tag of [GAPPED, CLEAN, OPP])
    await db.query(`insert into player (player_tag, name) values ($1, $1)`, [
      tag,
    ]);
  gatewayId = (
    await db.query(
      `insert into gateway (owner_account_id, name, static_ip, status)
       values ($1, 'Test', '203.0.113.9', 'active') returning gateway_id`,
      [accountId],
    )
  ).rows[0].gateway_id;

  // GAPPED: a snapshot on 09-17 at 100, one on 09-18 at 140 (expected 40);
  // 12 battles captured between; a gap read at 09-18 03:00Z.
  await snapshot(GAPPED, "2026-09-17", "2026-09-17T10:00:00Z", 100);
  await snapshot(GAPPED, "2026-09-18", "2026-09-18T10:00:00Z", 140);
  for (let i = 0; i < 12; i++)
    await battle(
      `g${i}`,
      `2026-09-18T0${i < 10 ? i : 9}:${i < 10 ? "00" : (i - 9) * 10}:00Z`,
      GAPPED,
    );
  await poll(GAPPED, "2026-09-18T01:00:00Z", {
    newFacts: 0,
    observed: 25,
    filtered: 25,
    gap: false,
  });
  await poll(GAPPED, "2026-09-18T03:00:00Z", {
    newFacts: 12,
    observed: 25,
    filtered: 0,
    gap: true,
  });
  // CLEAN: expected 20, captured 19 (the 5% the log never shows), no gap.
  await snapshot(CLEAN, "2026-09-17", "2026-09-17T11:00:00Z", 200);
  await snapshot(CLEAN, "2026-09-18", "2026-09-18T11:00:00Z", 220);
  for (let i = 0; i < 19; i++)
    await battle(
      `c${i}`,
      `2026-09-18T0${i < 10 ? i : 9}:${i < 10 ? "30" : (i - 9) * 5}:00Z`,
      CLEAN,
    );
  await poll(CLEAN, "2026-09-18T02:00:00Z", {
    newFacts: 19,
    observed: 19,
    filtered: 0,
    gap: false,
  });
  await poll(CLEAN, "2026-09-18T04:00:00Z", {
    newFacts: 0,
    observed: 19,
    filtered: 19,
    gap: false,
  });
  // A poll on the NEXT day must not count for 09-18.
  await poll(CLEAN, "2026-09-19T01:00:00Z", {
    newFacts: 0,
    observed: 19,
    filtered: 19,
    gap: false,
  });
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

test("one day's row: polls and what they found, gaps, and the loss net of the noise floor", async () => {
  const row = await efficiencyForDay(db, "2026-09-18");
  assert.equal(row.battlelog_polls, 4);
  assert.equal(row.productive_polls, 2);
  assert.equal(row.nothing_new_polls, 2);
  assert.equal(row.battles_captured, 31);
  assert.equal(row.audited_polls, 4);
  assert.equal(row.gaps, 1);
  assert.equal(row.intervals, 2);
  assert.equal(row.gap_intervals, 1);
  assert.equal(row.expected_gap, 40);
  assert.equal(row.captured_gap, 12);
  assert.equal(row.shortfall_gap, 28);
  assert.equal(row.expected_no_gap, 20);
  assert.equal(row.captured_no_gap, 19);
  assert.equal(row.shortfall_no_gap, 1);
  assert.equal(row.noise_rate, 0.05);
  // 28 - 0.05 x 40 = 26 battles the log rolled past.
  assert.equal(row.lost_battles, 26);
  assert.equal(row.players_with_gaps, 1);
});

test("the nightly run rewrites the last three closed days", async () => {
  const out = await captureEfficiency(DB_URL, { now: NOW });
  assert.deepEqual(
    out.days.map((d) => d.day),
    ["2026-09-16", "2026-09-17", "2026-09-18"],
  );
  const { rows } = await db.query(
    `select day::text, lost_battles, battlelog_polls from capture_efficiency_daily order by day`,
  );
  assert.deepEqual(rows, [
    { day: "2026-09-16", lost_battles: 0, battlelog_polls: 0 },
    { day: "2026-09-17", lost_battles: 0, battlelog_polls: 0 },
    { day: "2026-09-18", lost_battles: 26, battlelog_polls: 4 },
  ]);
  // A second run is an upsert, not a second row.
  await captureEfficiency(DB_URL, { now: NOW });
  const again = (
    await db.query(`select count(*)::int n from capture_efficiency_daily`)
  ).rows[0].n;
  assert.equal(again, 3);
});

test("the handler op runs it", async () => {
  process.env.DATABASE_URL = DB_URL;
  const out = await handler({ capture_efficiency: true });
  assert.equal(out.days.length, 3);
});
