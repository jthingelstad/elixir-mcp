import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { planTick, CADENCE } from "../src/plan.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_sched_${process.pid}`;
const URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

const NOW = new Date("2026-09-03T12:00:00Z");
const min = (n) => new Date(NOW.getTime() - n * 60_000);

let db;
let accountId;

async function addPlayer(tag, { clan = null } = {}) {
  await db.query(
    `insert into player (player_tag, last_known_clan_tag) values ($1, $2)
     on conflict (player_tag) do update set last_known_clan_tag = excluded.last_known_clan_tag`,
    [tag, clan],
  );
  if (clan)
    await db.query(
      `insert into clan (clan_tag) values ($1) on conflict do nothing`,
      [clan],
    );
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by) values ('player', $1, $2)`,
    [tag, accountId],
  );
}

async function setState(
  tag,
  endpoint,
  { heat, admitted, planned, heatUpdated } = {},
) {
  await db.query(
    `insert into poll_state (subject_tag, endpoint, heat, last_admitted_at, last_planned_at, heat_updated_at)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (subject_tag, endpoint) do update set
       heat = excluded.heat, last_admitted_at = excluded.last_admitted_at,
       last_planned_at = excluded.last_planned_at, heat_updated_at = excluded.heat_updated_at`,
    [
      tag,
      endpoint,
      heat ?? 2,
      admitted ?? null,
      planned ?? null,
      heatUpdated ?? NOW,
    ],
  );
}

/** Park the always-eligible GLOBAL cards row so job-set assertions stay
 *  about their own subjects. */
async function freshenCards(at) {
  await db.query(
    `insert into poll_state (subject_tag, endpoint, last_admitted_at, last_planned_at)
     values ('GLOBAL', 'cards', $1, $1)
     on conflict (subject_tag, endpoint)
       do update set last_admitted_at = $1, last_planned_at = $1`,
    [at],
  );
}

async function setTokens(tokens) {
  await db.query("update budget_state set tokens = $1, settled_at = $2", [
    tokens,
    NOW,
  ]);
}

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.query(`create database ${NAME}`);
  await admin.end();
  await migrate({
    databaseUrl: URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  db = new pg.Client({ connectionString: URL });
  await db.connect();
  const {
    rows: [a],
  } = await db.query(
    `insert into account (email_hash, status) values ('sched-owner', 'approved') returning account_id`,
  );
  accountId = a.account_id;
});

beforeEach(async () => {
  await db.query("delete from poll_state");
  await db.query("delete from recording");
  await db.query(`update budget_state set tokens = 0, settled_at = $1`, [NOW]);
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

test("new subject seeds warm and gets both player endpoints plus the followed clan", async () => {
  await addPlayer("#20JJJ2CCRU", { clan: "#J2RGCRVG" });
  await setTokens(100);
  const { jobs } = await planTick(db, NOW);
  const keys = jobs.map((j) => `${j.endpoint}:${j.entity_key}`).sort();
  assert.deepEqual(keys, [
    "cards:GLOBAL",
    "clan:#J2RGCRVG",
    "player:#20JJJ2CCRU",
    "player_battlelog:#20JJJ2CCRU",
  ]);
  assert.ok(jobs.every((j) => j.lane === "bulk"));
  const { rows } = await db.query(
    `select heat from poll_state where subject_tag = '#20JJJ2CCRU'`,
  );
  assert.ok(
    rows.every((r) => r.heat === 2),
    "seeded warm",
  );
});

test("budget caps selection and starved subjects strictly dominate hot ones", async () => {
  await freshenCards(NOW);
  await addPlayer("#YYYYYYYY");
  await addPlayer("#RRRRRRRR");
  // Hot and merely due:
  await setState("#YYYYYYYY", "player_battlelog", {
    heat: 3,
    admitted: min(20),
    planned: min(20),
  });
  // Cold and starved past the 24h floor:
  await setState("#RRRRRRRR", "player_battlelog", {
    heat: 0,
    admitted: min(CADENCE.player_battlelog.floor + 60),
    planned: min(CADENCE.player_battlelog.floor + 60),
  });
  // Make profiles ineligible so the comparison is clean:
  await setState("#YYYYYYYY", "player", {
    heat: 2,
    admitted: min(1),
    planned: min(1),
  });
  await setState("#RRRRRRRR", "player", {
    heat: 2,
    admitted: min(1),
    planned: min(1),
  });

  await setTokens(1);
  const { jobs } = await planTick(db, NOW);
  assert.equal(jobs.length, 0, "live reserve holds back the last token");

  await setTokens(2); // floor(2 * 0.9) = 1 job
  const { jobs: jobs2 } = await planTick(db, NOW);
  assert.equal(jobs2.length, 1);
  assert.equal(jobs2[0].entity_key, "#RRRRRRRR", "starvation floor beats heat");
});

test("heat decays one tier per epoch, before planning", async () => {
  await addPlayer("#YYYYYYYY");
  await setState("#YYYYYYYY", "player_battlelog", {
    heat: 3,
    admitted: min(20),
    planned: min(20),
    heatUpdated: min(90),
  });
  await setState("#YYYYYYYY", "player", {
    heat: 2,
    admitted: min(1),
    planned: min(1),
  });
  await setTokens(100);
  // heat 3 -> 2 (warm, cadence 60m); 20m since reference -> NOT due.
  const { jobs } = await planTick(db, NOW);
  assert.equal(jobs.filter((j) => j.endpoint === "player_battlelog").length, 0);
  const { rows } = await db.query(
    `select heat from poll_state where subject_tag = '#YYYYYYYY' and endpoint = 'player_battlelog'`,
  );
  assert.equal(rows[0].heat, 2);
});

test("tokens are consumed and an immediate second tick has no budget", async () => {
  await addPlayer("#YYYYYYYY");
  await setTokens(3); // floor(3*0.9) = 2 jobs
  const first = await planTick(db, NOW);
  assert.equal(first.jobs.length, 2);
  const second = await planTick(db, NOW);
  assert.equal(
    second.jobs.length,
    0,
    "bucket exhausted; accrual needs elapsed time",
  );
});

test("a planned job is not re-enqueued while in flight", async () => {
  await addPlayer("#YYYYYYYY");
  await setTokens(100);
  const first = await planTick(db, NOW);
  assert.ok(first.jobs.length > 0);
  await setTokens(100);
  const second = await planTick(db, new Date(NOW.getTime() + 60_000));
  assert.equal(second.jobs.length, 0, "last_planned_at suppresses replanning");
});

test("clan heartbeat respects its 15-minute cadence", async () => {
  await freshenCards(NOW);
  await addPlayer("#20JJJ2CCRU", { clan: "#J2RGCRVG" });
  await setState("#20JJJ2CCRU", "player_battlelog", {
    heat: 2,
    admitted: min(1),
    planned: min(1),
  });
  await setState("#20JJJ2CCRU", "player", {
    heat: 2,
    admitted: min(1),
    planned: min(1),
  });
  await setState("#J2RGCRVG", "clan", {
    heat: 2,
    admitted: min(10),
    planned: min(10),
  });
  await setTokens(100);
  const { jobs } = await planTick(db, NOW);
  assert.equal(jobs.length, 0, "10 minutes since clan poll: not yet due");

  await setState("#J2RGCRVG", "clan", {
    heat: 2,
    admitted: min(16),
    planned: min(16),
  });
  const { jobs: jobs2 } = await planTick(db, NOW);
  assert.deepEqual(
    jobs2.map((j) => `${j.endpoint}:${j.entity_key}`),
    ["clan:#J2RGCRVG"],
  );
});

test("budget accrues with elapsed time and caps at the carryover ceiling", async () => {
  await db.query(
    `update budget_state set tokens = 0, settled_at = $1, rate_per_sec = 1`,
    [min(60)],
  );
  const result = await planTick(db, NOW);
  assert.equal(
    result.tokens,
    300,
    "1 rps for an hour caps at 300 (5-minute carryover), never 3600",
  );
});

test("season-roll watcher forces profile polls in the pre-reset hour", async () => {
  const inWindow = new Date("2026-09-06T23:30:00Z"); // Sunday, reset in 40m
  await freshenCards(inWindow);
  await addPlayer("#YYYYYYYY");
  // Profile freshly admitted BEFORE the window; normal cadence says not due.
  await setState("#YYYYYYYY", "player", {
    heat: 2,
    admitted: new Date("2026-09-06T22:30:00Z"),
    planned: new Date("2026-09-06T22:30:00Z"),
  });
  await setState("#YYYYYYYY", "player_battlelog", {
    heat: 2,
    admitted: new Date("2026-09-06T23:25:00Z"),
    planned: new Date("2026-09-06T23:25:00Z"),
  });
  await db.query("update budget_state set tokens = 100, settled_at = $1", [
    inWindow,
  ]);
  const { jobs } = await planTick(db, inWindow);
  assert.deepEqual(
    jobs.map((j) => `${j.endpoint}:${j.entity_key}`),
    ["player:#YYYYYYYY"],
    "profile forced despite fresh cadence; battlelog untouched",
  );
  // Second tick inside the window: already planned in-window, no re-force.
  await db.query("update budget_state set tokens = 100, settled_at = $1", [
    inWindow,
  ]);
  const again = await planTick(db, new Date("2026-09-06T23:32:00Z"));
  assert.equal(again.jobs.length, 0);
});

test("clan recording: heartbeat, riverrace capture, and every open member polled", async () => {
  await db.query(
    `insert into clan (clan_tag) values ('#J2RGCRVG') on conflict do nothing`,
  );
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by) values ('clan', '#J2RGCRVG', $1)`,
    [accountId],
  );
  for (const tag of ["#YYYYYYYY", "#RRRRRRRR", "#22222222"]) {
    await db.query(
      `insert into player (player_tag) values ($1) on conflict do nothing`,
      [tag],
    );
    await db.query(
      `insert into clan_membership (clan_tag, player_tag, joined_observed_at) values ('#J2RGCRVG', $1, now())`,
      [tag],
    );
  }
  await setTokens(100);
  const { jobs } = await planTick(db, NOW);
  const keys = jobs.map((j) => `${j.endpoint}:${j.entity_key}`).sort();
  assert.ok(keys.includes("clan:#J2RGCRVG"), "clan heartbeat");
  assert.ok(
    keys.includes("currentriverrace:#J2RGCRVG"),
    "riverrace capture-only",
  );
  for (const tag of ["#YYYYYYYY", "#RRRRRRRR", "#22222222"]) {
    assert.ok(keys.includes(`player_battlelog:${tag}`), `${tag} battlelog`);
    assert.ok(keys.includes(`player:${tag}`), `${tag} profile`);
  }

  // A member leaves: their membership closes and they stop being planned.
  await db.query(
    `update clan_membership set left_observed_at = now() where player_tag = '#22222222'`,
  );
  await db.query(
    `delete from clan_membership where player_tag = '#22222222' and left_observed_at is not null`,
  );
  await db.query(
    `update poll_state set last_planned_at = null, last_admitted_at = null`,
  );
  await setTokens(100);
  const { jobs: jobs2 } = await planTick(db, NOW);
  const keys2 = jobs2.map((j) => `${j.endpoint}:${j.entity_key}`);
  assert.ok(
    !keys2.some((k) => k.endsWith("#22222222")),
    "departed member not planned",
  );
  assert.ok(
    keys2.includes("player_battlelog:#YYYYYYYY"),
    "remaining members still planned",
  );
});
