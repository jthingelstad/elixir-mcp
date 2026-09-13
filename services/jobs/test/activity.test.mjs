/**
 * The nightly battle-activity histogram (0084) over a scratch database:
 * decayed 24x7 buckets, UTC daily counts, and the not-recorded marks
 * from the capture audit and the coverage rule - carried forward across
 * rebuilds, and never before recording began.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import {
  activityHistogram,
  daysBetween,
  utcDay,
  BUCKETS,
  HALF_LIFE_DAYS,
} from "../src/activity.mjs";
import { handler } from "../src/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_activity_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

// A Sunday noon. 2026-09-08 is a Tuesday; 2026-08-16 is the Sunday
// exactly 28 days (one half-life) earlier; 2026-06-01 is a Monday.
const NOW = new Date("2026-09-13T12:00:00Z");
const PLAYER = "#P0P0P0P0";
const QUIET = "#P0P0P0P2"; // recorded, never played
const OPP = "#P0P0P0P8";

let db, accountId, gatewayId;

async function battle(id, at, tag = PLAYER) {
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class)
     values ($1, $2, 'PvP', 'pvp') on conflict do nothing`,
    [id, at],
  );
  await db.query(
    `insert into battle_participant (battle_id, player_tag, side, battle_time)
     values ($1, $2, 0, $3), ($1, $4, 1, $3) on conflict do nothing`,
    [id, tag, at, OPP],
  );
}

async function snapshot(date, observedAt, battleCount) {
  await db.query(
    `insert into player_snapshot_daily
       (player_tag, snapshot_date, snapshot_kind, observed_at, lifetime)
     values ($1, $2, 'daily', $3, $4::jsonb)`,
    [PLAYER, date, observedAt, JSON.stringify({ battleCount })],
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
  accountId = (
    await db.query(
      `insert into account (email_hash, status) values ('activity-test', 'approved')
       returning account_id`,
    )
  ).rows[0].account_id;
  for (const tag of [PLAYER, QUIET, OPP])
    await db.query(`insert into player (player_tag, name) values ($1, $1)`, [
      tag,
    ]);
  // Recording began ten days before NOW for both recorded players.
  for (const tag of [PLAYER, QUIET])
    await db.query(
      `insert into recording (subject_type, subject_tag, requested_by, created_at)
       values ('player', $1, $2, $3)`,
      [tag, accountId, new Date("2026-09-03T12:00:00Z")],
    );
  gatewayId = (
    await db.query(
      `insert into gateway (owner_account_id, name, static_ip, status)
       values ($1, 'Test', '203.0.113.9', 'active') returning gateway_id`,
      [accountId],
    )
  ).rows[0].gateway_id;

  // A: Tuesday 14:30Z, 4.9 days old. B: exactly one half-life old.
  // C: Monday 10:00Z, 104 days old (outside 28 d, inside the year).
  // E: inside the incomplete snapshot interval below. Z: outside the year.
  await battle("a", "2026-09-08T14:30:00Z");
  await battle("b", "2026-08-16T12:00:00Z");
  await battle("c", "2026-06-01T10:00:00Z");
  await battle("e", "2026-09-06T20:00:00Z");
  await battle("z", "2025-01-01T10:00:00Z");
  // The counter moved by 3 between these snapshots and one battle (E) was
  // captured: the coverage rule marks 09-05, 09-06 and 09-07.
  await snapshot("2026-09-05", "2026-09-05T10:00:00Z", 100);
  await snapshot("2026-09-07", "2026-09-07T10:00:00Z", 103);
  // A capture-audit gap on 09-10.
  const receipt = (
    await db.query(
      `insert into api_receipt (endpoint, entity_key, fetched_at, payload_hash, gateway_id, admission)
       values ('player_battlelog', $1, '2026-09-10T03:00:00Z', 'h', $2, 'admitted')
       returning receipt_id`,
      [PLAYER, gatewayId],
    )
  ).rows[0].receipt_id;
  await db.query(
    `insert into capture_audit (receipt_id, subject_tag, gap, fetched_at)
     values ($1, $2, true, '2026-09-10T03:00:00Z')`,
    [receipt, PLAYER],
  );
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

test("daysBetween walks UTC days inclusive; utcDay is the UTC calendar day", () => {
  assert.deepEqual(
    daysBetween("2026-09-05T10:00:00Z", "2026-09-07T10:00:00Z"),
    ["2026-09-05", "2026-09-06", "2026-09-07"],
  );
  assert.equal(utcDay("2026-09-13T23:59:59Z"), "2026-09-13");
});

test("rebuild: decayed buckets, daily counts, marks from both rules, and a zero row for a quiet player", async () => {
  const out = await activityHistogram(DB_URL, { now: NOW });
  assert.equal(out.players, 2);
  assert.equal(out.with_battles, 1);
  const { rows } = await db.query(
    `select * from player_activity where player_tag = $1`,
    [PLAYER],
  );
  const row = rows[0];
  assert.equal(row.rhythm.length, BUCKETS);
  assert.equal(row.half_life_days, HALF_LIFE_DAYS);
  // Tuesday 14h = (2-1)*24 + 14; 4 d 21.5 h old.
  const ageA = (NOW - Date.parse("2026-09-08T14:30:00Z")) / 86_400_000;
  assert.ok(Math.abs(row.rhythm[38] - 2 ** (-ageA / 28)) < 1e-3, "A decays");
  // Sunday 12h = 6*24 + 12, exactly one half-life: half a battle.
  assert.ok(Math.abs(row.rhythm[156] - 0.5) < 1e-3, "B is half");
  // Monday 10h, 104 days: a quarter of a quarter and a bit.
  assert.ok(Math.abs(row.rhythm[10] - 2 ** (-104.083 / 28)) < 1e-3, "C fades");
  // Sunday 20h = 6*24 + 20.
  assert.ok(row.rhythm[164] > 0.8, "E recent");
  assert.equal(row.rhythm_battles, 4, "Z is outside the year");
  assert.equal(
    row.battles_28d,
    2,
    "A and E inside 28 d; B is on the edge, out",
  );
  assert.deepEqual(row.days, {
    "2026-09-08": 1,
    "2026-08-16": 1,
    "2026-06-01": 1,
    "2026-09-06": 1,
  });
  assert.deepEqual(row.not_recorded_days, [
    "2026-09-05",
    "2026-09-06",
    "2026-09-07",
    "2026-09-10",
  ]);
  assert.equal(utcDay(row.recorded_from), "2026-09-03");
  assert.equal(row.first_battle_at.toISOString(), "2026-06-01T10:00:00.000Z");
  assert.equal(row.last_battle_at.toISOString(), "2026-09-08T14:30:00.000Z");
  const weight = row.rhythm.reduce((n, w) => n + w, 0);
  assert.ok(Math.abs(Number(row.rhythm_weight) - weight) < 1e-2);

  const quiet = (
    await db.query(`select * from player_activity where player_tag = $1`, [
      QUIET,
    ])
  ).rows[0];
  assert.ok(quiet, "a recorded player with no battles still gets a row");
  assert.equal(quiet.rhythm_battles, 0);
  assert.deepEqual(quiet.days, {});
  assert.equal(Number(quiet.rhythm_weight), 0);
});

test("marks never precede recording; older marks carry forward across rebuilds", async () => {
  // A gap the day before recording began must not be marked: those days
  // are the reader's, from recorded_from.
  const receipt = (
    await db.query(
      `insert into api_receipt (endpoint, entity_key, fetched_at, payload_hash, gateway_id, admission)
       values ('player_battlelog', $1, '2026-09-01T03:00:00Z', 'h2', $2, 'admitted')
       returning receipt_id`,
      [PLAYER, gatewayId],
    )
  ).rows[0].receipt_id;
  await db.query(
    `insert into capture_audit (receipt_id, subject_tag, gap, fetched_at)
     values ($1, $2, true, '2026-09-01T03:00:00Z')`,
    [receipt, PLAYER],
  );
  // The snapshot pair is gone (as it would be once it ages past the
  // window the rule re-reads); its marks must survive the rebuild.
  await db.query(`delete from player_snapshot_daily where player_tag = $1`, [
    PLAYER,
  ]);
  await activityHistogram(DB_URL, { now: NOW });
  const row = (
    await db.query(`select * from player_activity where player_tag = $1`, [
      PLAYER,
    ])
  ).rows[0];
  assert.deepEqual(row.not_recorded_days, [
    "2026-09-05",
    "2026-09-06",
    "2026-09-07",
    "2026-09-10",
  ]);
  assert.equal(
    (await db.query(`select count(*)::int as n from player_activity`)).rows[0]
      .n,
    2,
    "one row per recorded player, rebuilt in place",
  );
});

test("the handler routes {activity_histogram: true} to the rebuild", async () => {
  process.env.DATABASE_URL = DB_URL;
  const result = await handler({ activity_histogram: true });
  assert.equal(result.players, 2);
});
