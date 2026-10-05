import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { ensureSeason } from "../../../packages/record/src/season.mjs";
import { migrate } from "../../migrate/src/migrate.mjs";
import {
  planTick,
  CADENCE,
  yieldCadenceMinutes,
  sessionWaitMinutes,
  READ_CAP_MINUTES,
  SESSION_CEILING_MINUTES,
  SESSION_FOLLOWUP_MINUTES,
  eligibleNow,
  queueSummary,
  dueAfterMs,
  jitterFactor,
} from "../../../packages/ledger/src/plan.mjs";
import { tickOnce } from "../src/handler.mjs";
import { processResult } from "../../../packages/ingest/src/pipeline.mjs";

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

async function setState(tag, endpoint, { yieldBph, admitted, planned } = {}) {
  await db.query(
    `insert into poll_state (subject_tag, endpoint, yield_bph, last_admitted_at, last_planned_at)
     values ($1, $2, $3, $4, $5)
     on conflict (subject_tag, endpoint) do update set
       yield_bph = excluded.yield_bph, last_admitted_at = excluded.last_admitted_at,
       last_planned_at = excluded.last_planned_at`,
    [tag, endpoint, yieldBph ?? null, admitted ?? null, planned ?? null],
  );
}

/** Park the always-eligible GLOBAL rows - the card catalog and, since
 *  0069, the game-mode board list, the events and the tournaments - so
 *  job-set assertions stay about their own subjects. */
async function freshenCards(at) {
  await db.query(
    `insert into poll_state (subject_tag, endpoint, last_admitted_at, last_planned_at)
     select 'GLOBAL', e, $1, $1
     from unnest(array['cards', 'leaderboards', 'events', 'globaltournaments']) e
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

test("new subject seeds both player endpoints plus the followed clan", async () => {
  await addPlayer("#20JJJ2CCRU", { clan: "#J2RGCRVG" });
  await setTokens(100);
  const { jobs } = await planTick(db, NOW);
  const keys = jobs.map((j) => `${j.endpoint}:${j.entity_key}`).sort();
  // A fresh tick also plans every subject-less daily read once: the card
  // catalog, and since 0069 the game-mode board list, the events and the
  // tournaments.
  assert.deepEqual(keys, [
    "cards:GLOBAL",
    "clan:#J2RGCRVG",
    "events:GLOBAL",
    "globaltournaments:GLOBAL",
    "player:#20JJJ2CCRU",
    "player_battlelog:#20JJJ2CCRU",
  ]);
  assert.ok(jobs.every((j) => j.lane === "bulk"));
});

test("every tick keeps the running and the next season as rows (0104)", async () => {
  // Ticked past the seed: a tick in 2027 writes what the seed lacks and
  // the next tick writes nothing.
  const later = new Date("2027-02-10T12:00:00Z");
  await setTokens(0);
  await planTick(db, later);
  const { rows } = await db.query(
    `select season_month, war_season_id from season where season_month >= '2027-02' order by 1`,
  );
  assert.deepEqual(rows, [
    { season_month: "2027-02", war_season_id: 141 },
    { season_month: "2027-03", war_season_id: 142 },
  ]);
  await planTick(db, later);
  const { rows: again } = await db.query(
    `select count(*)::int as n from season where season_month >= '2027-02'`,
  );
  assert.equal(again[0].n, 2);
});

test("budget caps selection and starved subjects strictly dominate busy ones", async () => {
  await freshenCards(NOW);
  await addPlayer("#YYYYYYYY");
  await addPlayer("#RRRRRRRR");
  // Busy (high yield) and merely due:
  await setState("#YYYYYYYY", "player_battlelog", {
    yieldBph: 5,
    admitted: min(90),
    planned: min(90),
  });
  // Dormant and starved past the 24h floor:
  await setState("#RRRRRRRR", "player_battlelog", {
    yieldBph: 0,
    admitted: min(CADENCE.player_battlelog.floor + 60),
    planned: min(CADENCE.player_battlelog.floor + 60),
  });
  // Make profiles ineligible so the comparison is clean:
  await setState("#YYYYYYYY", "player", {
    admitted: min(1),
    planned: min(1),
  });
  await setState("#RRRRRRRR", "player", {
    admitted: min(1),
    planned: min(1),
  });

  await setTokens(1);
  const { jobs } = await planTick(db, NOW);
  assert.equal(jobs.length, 0, "live reserve holds back the last token");

  await setTokens(2); // floor(2 * 0.9) = 1 job
  const { jobs: jobs2 } = await planTick(db, NOW);
  assert.equal(jobs2.length, 1);
  assert.equal(
    jobs2[0].entity_key,
    "#RRRRRRRR",
    "starvation floor beats yield",
  );
});

test("tokens are consumed and an immediate second tick has no budget", async () => {
  await db.query("delete from job");
  await addPlayer("#YYYYYYYY");
  await setTokens(3); // floor(3*0.9) = 2 jobs
  const first = await tickOnce(db, NOW);
  assert.equal(first.jobs.length, 2);
  assert.equal(first.tokensAfter, 1, "the two inserted rows were charged");
  const second = await tickOnce(db, NOW);
  assert.equal(
    second.jobs.length,
    0,
    "bucket exhausted; accrual needs elapsed time",
  );
  await db.query("delete from job");
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

test("clan cadence: who cares x how alive it is now (2026-09-11)", async () => {
  await freshenCards(NOW);
  const setClan = (tag, { hint, churn = null, minutesAgo }) =>
    db.query(
      `insert into poll_state (subject_tag, endpoint, hint, yield_bph, last_admitted_at, last_planned_at)
       values ($1, 'clan', $2, $3, $4, $4)
       on conflict (subject_tag, endpoint) do update set
         hint = excluded.hint, yield_bph = excluded.yield_bph,
         last_admitted_at = excluded.last_admitted_at, last_planned_at = excluded.last_planned_at`,
      [tag, hint, churn, min(minutesAgo)],
    );
  const planned = async () => {
    await setTokens(100);
    const { jobs } = await planTick(db, NOW);
    return jobs
      .filter((j) => j.endpoint === "clan")
      .map((j) => j.entity_key)
      .sort();
  };

  // An INCIDENTAL clan: a recorded player is in it, nobody tracks it.
  await addPlayer("#20JJJ2CCRU", { clan: "#J2RGCRVG" });
  await setState("#20JJJ2CCRU", "player_battlelog", {
    admitted: min(1),
    planned: min(1),
  });
  await setState("#20JJJ2CCRU", "player", {
    admitted: min(1),
    planned: min(1),
  });
  // Nothing stamped yet: the active branch - 4 hours, not 15 minutes.
  await setClan("#J2RGCRVG", { hint: null, minutesAgo: 60 });
  assert.deepEqual(await planned(), [], "incidental, unknown: not due at 60m");
  await setClan("#J2RGCRVG", { hint: null, minutesAgo: 300 });
  assert.deepEqual(
    await planned(),
    ["#J2RGCRVG"],
    "incidental, active: due past 4h",
  );
  await setClan("#J2RGCRVG", { hint: "idle", minutesAgo: 300 });
  assert.deepEqual(await planned(), [], "incidental, idle: 12h");
  await setClan("#J2RGCRVG", { hint: "asleep", minutesAgo: 900 });
  assert.deepEqual(await planned(), [], "incidental, asleep: 24h");
  await setClan("#J2RGCRVG", { hint: "asleep", minutesAgo: 1700 });
  assert.deepEqual(await planned(), ["#J2RGCRVG"]);

  // The same clan once somebody TRACKS it.
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by, scope)
     values ('clan', '#J2RGCRVG', $1, 'activity')`,
    [accountId],
  );
  // 18, not 16: cadences carry a stable per-subject jitter of +/-15%, so
  // 15 minutes is due somewhere in [12.75, 17.25] depending on the tag.
  await setClan("#J2RGCRVG", { hint: "active", minutesAgo: 10 });
  assert.deepEqual(await planned(), [], "tracked, active: 10m is not yet 15m");
  await setClan("#J2RGCRVG", { hint: "active", minutesAgo: 18 });
  assert.deepEqual(await planned(), ["#J2RGCRVG"], "tracked, active: 15m");
  await setClan("#J2RGCRVG", { hint: "idle", minutesAgo: 40 });
  assert.deepEqual(await planned(), [], "tracked, idle: 60m");
  await setClan("#J2RGCRVG", { hint: "idle", minutesAgo: 75 });
  assert.deepEqual(await planned(), ["#J2RGCRVG"]);
  await setClan("#J2RGCRVG", { hint: "idle", churn: 0.2, minutesAgo: 18 });
  assert.deepEqual(
    await planned(),
    ["#J2RGCRVG"],
    "tracked, idle but churning >=3/day: 15m",
  );
  await setClan("#J2RGCRVG", { hint: "asleep", minutesAgo: 200 });
  assert.deepEqual(await planned(), [], "tracked, asleep: 4h");
  await setClan("#J2RGCRVG", { hint: "asleep", minutesAgo: 300 });
  assert.deepEqual(await planned(), ["#J2RGCRVG"]);
  await db.query(`delete from recording where subject_type = 'clan'`);
});

test("a requested profile refresh (0101) is owed now: ahead of the cadence, once", async () => {
  await freshenCards(NOW);
  await db.query(
    `insert into clan (clan_tag) values ('#G8Q2LPY') on conflict do nothing`,
  );
  await addPlayer("#G8U2L9", { clan: "#G8Q2LPY" });
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by, scope)
     values ('clan', '#G8Q2LPY', $1, 'comprehensive')`,
    [accountId],
  );
  // The profile was polled two hours ago (nowhere near a day). Then
  // ingest saw their own battles name an arena the snapshot lacks,
  // twenty minutes ago.
  await setState("#G8U2L9", "player_battlelog", {
    yieldBph: 5,
    admitted: min(5),
    planned: min(5),
  });
  await setState("#G8U2L9", "player", {
    admitted: min(120),
    planned: min(120),
  });
  await setState("#G8Q2LPY", "clan", { admitted: min(10), planned: min(10) });
  await db.query(
    `update player set game_last_seen_at = $2 where player_tag = $1`,
    ["#G8U2L9", min(300)],
  );
  await setTokens(100);
  const quiet = await planTick(db, NOW);
  assert.deepEqual(
    quiet.jobs.filter((j) => j.entity_key === "#G8U2L9"),
    [],
    "without a request the profile waits: not due",
  );
  assert.equal(quiet.requested, 0);

  await db.query(
    `update poll_state set refresh_requested_at = $2
     where subject_tag = $1 and endpoint = 'player'`,
    ["#G8U2L9", min(20)],
  );
  await setState("#G8U2L9", "player", {
    admitted: min(120),
    planned: min(120),
  });
  await setTokens(100);
  const asked = await planTick(db, NOW);
  assert.deepEqual(
    asked.jobs.filter((j) => j.entity_key === "#G8U2L9").map((j) => j.endpoint),
    ["player"],
    "the request is a floor: the cadence steps aside",
  );
  assert.equal(asked.requested, 1);

  // In flight: planned just now, not re-enqueued.
  await setTokens(100);
  const inFlight = await planTick(db, NOW);
  assert.deepEqual(
    inFlight.jobs.filter((j) => j.entity_key === "#G8U2L9"),
    [],
  );

  // Served: an admission after the stamp ends it, with nothing to clear.
  await setState("#G8U2L9", "player", { admitted: min(1), planned: min(1) });
  await setTokens(100);
  const served = await planTick(db, NOW);
  assert.deepEqual(
    served.jobs.filter((j) => j.entity_key === "#G8U2L9"),
    [],
  );
  assert.equal(served.requested, 0);
});

/** setState with the session clock's streak. */
async function setClock(tag, { streak, admitted, planned, read = null }) {
  await db.query(
    `insert into poll_state (subject_tag, endpoint, empty_streak, last_admitted_at, last_planned_at, last_read_at)
     values ($1, 'player_battlelog', $2, $3, $4, $5)
     on conflict (subject_tag, endpoint) do update set
       empty_streak = excluded.empty_streak, last_admitted_at = excluded.last_admitted_at,
       last_planned_at = excluded.last_planned_at, last_read_at = excluded.last_read_at`,
    [tag, streak, admitted, planned, read],
  );
}

test("the session clock: a tracked and an incidental player walked through a session and a cool-down", async () => {
  await freshenCards(NOW);
  await db.query(
    `insert into clan (clan_tag) values ('#G8Q2LPY'), ('#8C9LQPY') on conflict do nothing`,
  );
  // Tracked: a member of a comprehensively recorded clan. Incidental: a
  // recorded player whose clan nobody tracks. The clock is the same for
  // both - the roster never gates a battle log (2026-09-12) and the
  // session clock reads nothing but the row's own streak.
  await addPlayer("#G8U2L9", { clan: "#G8Q2LPY" });
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by, scope)
     values ('clan', '#G8Q2LPY', $1, 'comprehensive')`,
    [accountId],
  );
  await addPlayer("#8C9LQ2U", { clan: "#8C9LQPY" });
  await setState("#G8Q2LPY", "clan", { admitted: min(5), planned: min(5) });
  await setState("#8C9LQPY", "clan", { admitted: min(5), planned: min(5) });
  // Park the profiles: read an hour ago, nothing owed.
  for (const tag of ["#G8U2L9", "#8C9LQ2U"])
    await setState(tag, "player", { admitted: min(60), planned: min(60) });

  const battlelogs = async () => {
    await setTokens(100);
    const r = await planTick(db, NOW);
    return r.jobs
      .filter((j) => j.endpoint === "player_battlelog")
      .map((j) => j.entity_key)
      .sort();
  };
  // Playing (streak 0): read 20 minutes ago - not yet; 35 minutes ago - due
  // (jitter is +/-15% of 30 min, so 35 clears it for every hash).
  for (const tag of ["#G8U2L9", "#8C9LQ2U"])
    await setClock(tag, { streak: 0, admitted: min(20), planned: min(20) });
  assert.deepEqual(await battlelogs(), []);
  for (const tag of ["#G8U2L9", "#8C9LQ2U"])
    await setClock(tag, { streak: 0, admitted: min(35), planned: min(35) });
  const playing = await planTick(db, NOW);
  assert.deepEqual(
    playing.jobs
      .filter((j) => j.endpoint === "player_battlelog")
      .map((j) => j.entity_key)
      .sort(),
    ["#8C9LQ2U", "#G8U2L9"],
  );
  assert.equal(playing.followup, 2, "both reads are session follow-ups");

  // Cooling down: one empty read -> 60 min; two -> 120 (the ceiling);
  // ten -> still the ceiling. 50 minutes is not enough at streak 1, 70
  // is; 100 is not enough at streak 2, 140 is.
  for (const tag of ["#G8U2L9", "#8C9LQ2U"])
    await setClock(tag, { streak: 1, admitted: min(50), planned: min(50) });
  assert.deepEqual(await battlelogs(), []);
  for (const tag of ["#G8U2L9", "#8C9LQ2U"])
    await setClock(tag, { streak: 1, admitted: min(70), planned: min(70) });
  assert.deepEqual(await battlelogs(), ["#8C9LQ2U", "#G8U2L9"]);
  for (const tag of ["#G8U2L9", "#8C9LQ2U"])
    await setClock(tag, { streak: 2, admitted: min(100), planned: min(100) });
  assert.deepEqual(await battlelogs(), []);
  for (const tag of ["#G8U2L9", "#8C9LQ2U"])
    await setClock(tag, { streak: 10, admitted: min(140), planned: min(140) });
  const cooled = await planTick(db, NOW);
  assert.deepEqual(
    cooled.jobs
      .filter((j) => j.endpoint === "player_battlelog")
      .map((j) => j.entity_key)
      .sort(),
    ["#8C9LQ2U", "#G8U2L9"],
    "no streak takes a player past the ceiling",
  );
  assert.equal(cooled.followup, 0, "a ceiling read is not a follow-up");

  // A reader asked about the incidental player: the cap makes an hourly
  // read due even at the ceiling.
  await setClock("#8C9LQ2U", {
    streak: 10,
    admitted: min(70),
    planned: min(70),
    read: min(10),
  });
  await setClock("#G8U2L9", {
    streak: 10,
    admitted: min(70),
    planned: min(70),
  });
  const asked = await planTick(db, NOW);
  assert.deepEqual(
    asked.jobs
      .filter((j) => j.endpoint === "player_battlelog")
      .map((j) => j.entity_key),
    ["#8C9LQ2U"],
  );
  assert.equal(asked.readCapped, 1);

  // A row never stamped waits one follow-up: discovery, not dormancy.
  await setClock("#G8U2L9", {
    streak: null,
    admitted: min(35),
    planned: min(35),
  });
  await setClock("#8C9LQ2U", {
    streak: null,
    admitted: min(20),
    planned: min(20),
  });
  assert.deepEqual(await battlelogs(), ["#G8U2L9"]);
});

test("profiles are read once a day, eight hours when directly tracked, and now after a session", async () => {
  await freshenCards(NOW);
  await db.query(
    `insert into clan (clan_tag) values ('#R9YQ0LP') on conflict do nothing`,
  );
  await addPlayer("#R9YQ0L2", { clan: "#R9YQ0LP" });
  await setClock("#R9YQ0L2", {
    streak: 3,
    admitted: min(30),
    planned: min(30),
  });
  const profile = async () => {
    await setTokens(100);
    const r = await planTick(db, NOW);
    return r.jobs.some(
      (j) => j.entity_key === "#R9YQ0L2" && j.endpoint === "player",
    );
  };
  // Twenty hours: not yet (jitter can reach 1.15 x 1440 = 1,656 min, so
  // the due case is set at 1,700).
  await setState("#R9YQ0L2", "player", {
    admitted: min(20 * 60),
    planned: min(20 * 60),
  });
  assert.equal(await profile(), false, "a day has not passed");
  await setState("#R9YQ0L2", "player", {
    admitted: min(1700),
    planned: min(1700),
  });
  assert.equal(await profile(), true, "a day has passed");
  assert.equal(
    yieldCadenceMinutes({ endpoint: "player", yield_bph: 5 }),
    1440,
    "no activity branch: the day is the cadence for everyone",
  );
  assert.equal(
    yieldCadenceMinutes({ endpoint: "player", directly_tracked: true }),
    480,
  );
  // After a session (ingest stamped the request 10 minutes ago, the last
  // admission before it): owed now, at two hours since the last read.
  await setState("#R9YQ0L2", "player", {
    admitted: min(120),
    planned: min(120),
  });
  await db.query(
    `update poll_state set refresh_requested_at = $2 where subject_tag = $1 and endpoint = 'player'`,
    ["#R9YQ0L2", min(10)],
  );
  await setTokens(100);
  const primed = await planTick(db, NOW);
  assert.ok(
    primed.jobs.some(
      (j) => j.entity_key === "#R9YQ0L2" && j.endpoint === "player",
    ),
  );
  assert.equal(primed.requested, 1);
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
    admitted: new Date("2026-09-06T22:30:00Z"),
    planned: new Date("2026-09-06T22:30:00Z"),
  });
  await setState("#YYYYYYYY", "player_battlelog", {
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
    `insert into recording (subject_type, subject_tag, requested_by, scope) values ('clan', '#J2RGCRVG', $1, 'comprehensive')`,
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

test("cadence: the session clock for battle logs, the day for profiles, hinted war days", () => {
  const c = (row) => yieldCadenceMinutes(row);
  // Battlelog: 30 x 2^streak, never past the ceiling; a row never stamped
  // waits one follow-up. The yield signal is not read.
  assert.equal(c({ endpoint: "player_battlelog", empty_streak: null }), 30);
  assert.equal(c({ endpoint: "player_battlelog", empty_streak: 0 }), 30);
  assert.equal(c({ endpoint: "player_battlelog", empty_streak: 1 }), 60);
  assert.equal(c({ endpoint: "player_battlelog", empty_streak: 2 }), 120);
  assert.equal(c({ endpoint: "player_battlelog", empty_streak: 3 }), 120);
  assert.equal(c({ endpoint: "player_battlelog", empty_streak: 40 }), 120);
  assert.equal(
    c({ endpoint: "player_battlelog", empty_streak: 9, yield_bph: 20 }),
    120,
    "a grinder's yield buys no shorter wait: the streak is the signal",
  );
  assert.equal(
    sessionWaitMinutes({ empty_streak: 0 }),
    SESSION_FOLLOWUP_MINUTES,
  );
  assert.equal(
    sessionWaitMinutes({ empty_streak: 99 }),
    SESSION_CEILING_MINUTES,
  );
  // Profiles: the day, whatever the activity; eight hours when tracked.
  assert.equal(c({ endpoint: "player", yield_bph: 0.005 }), 1440);
  assert.equal(c({ endpoint: "player", yield_bph: 2 }), 1440);
  assert.equal(c({ endpoint: "player", yield_bph: null }), 1440);
  assert.equal(
    c({ endpoint: "player", yield_bph: null, directly_tracked: true }),
    480,
    "a directly tracked player's profile has an eight-hour nominal cap",
  );
  // The payload names war days.
  assert.equal(
    c({ endpoint: "currentriverrace", period_type: "training" }),
    120,
  );
  assert.equal(c({ endpoint: "currentriverrace", period_type: "warDay" }), 30);
  assert.equal(c({ endpoint: "currentriverrace", period_type: null }), 30);
});

test("a direct claim carries the eight-hour profile cap into planning", async () => {
  await freshenCards(NOW);
  await addPlayer("#QRYJCU");
  await db.query(
    `insert into claim (account_id, player_tag)
     values ($1, '#QRYJCU')`,
    [accountId],
  );
  await setState("#QRYJCU", "player_battlelog", {
    yieldBph: 0.01,
    admitted: min(1),
    planned: min(1),
  });
  await setState("#QRYJCU", "player", {
    admitted: min(600),
    planned: min(600),
  });
  await setTokens(100);
  const { jobs } = await planTick(db, NOW);
  assert.deepEqual(
    jobs.map((job) => `${job.endpoint}:${job.entity_key}`),
    ["player:#QRYJCU"],
  );
});

test("yield ranking: busy-and-a-bit-overdue beats dormant-and-long-overdue; floors still dominate", async () => {
  await freshenCards(NOW);
  await addPlayer("#PYGRJC");
  await addPlayer("#PYGRJG");
  // Busy: 6 bph, 2h overdue. Dormant: 0.01 bph, 20h overdue (below the
  // 24h starvation floor so ranking decides, not fairness).
  await setState("#PYGRJC", "player_battlelog", {
    admitted: min(120),
    planned: min(120),
  });
  await setState("#PYGRJG", "player_battlelog", {
    admitted: min(1200),
    planned: min(1200),
  });
  await db.query(
    `update poll_state set yield_bph = 6 where subject_tag = '#PYGRJC'`,
  );
  await db.query(
    `update poll_state set yield_bph = 0.01 where subject_tag = '#PYGRJG'`,
  );
  // Park their profile endpoints.
  for (const t of ["#PYGRJC", "#PYGRJG"]) {
    await setState(t, "player", { admitted: min(1), planned: min(1) });
    await db.query(
      `update poll_state set yield_bph = 0.01 where subject_tag = $1 and endpoint = 'player'`,
      [t],
    );
  }
  await setTokens(2); // one job after live reserve
  const { jobs } = await planTick(db, NOW);
  assert.equal(jobs.length, 1);
  assert.equal(
    jobs[0].entity_key,
    "#PYGRJC",
    "expected harvest outranks raw overdue",
  );
});

test("clan scope: 'activity' records the clan only; upgrade re-seeds members", async () => {
  await db.query("delete from recording");
  await db.query("delete from poll_state");
  await db.query(
    `insert into clan (clan_tag) values ('#2PP0V90Y') on conflict do nothing`,
  );
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by, scope)
     values ('clan', '#2PP0V90Y', $1, 'activity')`,
    [accountId],
  );
  await db.query(
    `insert into player (player_tag) values ('#LLLLLLLL') on conflict do nothing`,
  );
  await db.query(
    `insert into clan_membership (clan_tag, player_tag, joined_observed_at)
     values ('#2PP0V90Y', '#LLLLLLLL', now())
     on conflict do nothing`,
  );
  await setTokens(100);
  const { jobs } = await planTick(db, NOW);
  const keys = jobs.map((j) => `${j.endpoint}:${j.entity_key}`);
  assert.ok(keys.includes("clan:#2PP0V90Y"), "clan heartbeat still polled");
  assert.ok(
    keys.includes("currentriverrace:#2PP0V90Y"),
    "war capture still polled",
  );
  assert.ok(
    !keys.some((k) => k.endsWith(":#LLLLLLLL")),
    "activity scope never polls members",
  );

  // Upgrade to comprehensive: members seed on the next tick.
  await db.query(
    `update recording set scope = 'comprehensive'
     where subject_type = 'clan' and subject_tag = '#2PP0V90Y'`,
  );
  await db.query(
    `update poll_state set last_planned_at = null, last_admitted_at = null`,
  );
  await setTokens(100);
  const { jobs: jobs2 } = await planTick(db, NOW);
  const keys2 = jobs2.map((j) => `${j.endpoint}:${j.entity_key}`);
  assert.ok(
    keys2.includes("player_battlelog:#LLLLLLLL"),
    "comprehensive polls members",
  );
});

// ---------------------------------------------------------------- 0061
// Production shapes from docs/archive/FETCH-LOOP-AUDIT-2026-09-09.md, pinned.

test("reader cap: a friend on the ceiling polls hourly for a day after a read", () => {
  const c = (row) => yieldCadenceMinutes(row, NOW);
  const friend = { endpoint: "player_battlelog", empty_streak: 5 };
  assert.equal(c(friend), SESSION_CEILING_MINUTES);
  assert.equal(c({ ...friend, last_read_at: min(120) }), READ_CAP_MINUTES);
  assert.equal(
    c({ ...friend, last_read_at: min(25 * 60) }),
    SESSION_CEILING_MINUTES,
  );
  // A cap never loosens a session follow-up.
  assert.equal(
    c({ endpoint: "player_battlelog", empty_streak: 0, last_read_at: min(1) }),
    30,
  );
});

async function stampRead(tag, readAt) {
  await db.query(
    `update poll_state set last_read_at = $2
     where subject_tag = $1 and endpoint = 'player_battlelog'`,
    [tag, readAt ?? null],
  );
}

test("a read within the day makes a clamped friend due; an older read does not", async () => {
  await freshenCards(NOW);
  await addPlayer("#L2VY9P");
  await addPlayer("#L2VY9Y");
  for (const t of ["#L2VY9P", "#L2VY9Y"]) {
    // On the ceiling (two hours; jitter floor 102 min), polled 90 min ago.
    await setClock(t, { streak: 5, admitted: min(90), planned: min(90) });
    await setState(t, "player", { admitted: min(1), planned: min(1) });
  }
  await stampRead("#L2VY9P", min(60));
  await stampRead("#L2VY9Y", min(25 * 60));
  await setTokens(100);
  const { jobs, readCapped } = await planTick(db, NOW);
  assert.deepEqual(
    jobs.map((j) => j.entity_key),
    ["#L2VY9P"],
    "read an hour ago: polled; read yesterday: still on the ceiling",
  );
  assert.equal(readCapped, 1);
});

test("eligibleNow reports what the next tick would plan without planning it", async () => {
  await freshenCards(NOW);
  await addPlayer("#L2VY9Q8");
  // Battlelog: 3 bph -> 100m, last polled 3h ago: due. Profile: fresh.
  await setState("#L2VY9Q8", "player_battlelog", {
    yieldBph: 3,
    admitted: min(180),
    planned: min(180),
  });
  await setState("#L2VY9Q8", "player", { admitted: min(1), planned: min(1) });
  const before = await db.query(
    `select last_planned_at from poll_state where subject_tag = '#L2VY9Q8' and endpoint = 'player_battlelog'`,
  );
  const eligible = await eligibleNow(db, NOW, "off");
  const summary = queueSummary(eligible);
  assert.equal(summary.by_endpoint.player_battlelog, 1);
  assert.equal(summary.due, eligible.length);
  assert.equal(summary.starved, 0);
  const after = await db.query(
    `select last_planned_at from poll_state where subject_tag = '#L2VY9Q8' and endpoint = 'player_battlelog'`,
  );
  assert.equal(
    String(after.rows[0].last_planned_at),
    String(before.rows[0].last_planned_at),
    "a read-only view stamps nothing",
  );
});

test("a two-hour fleet outage leaves the ledger within the bucket, and recovery stays inside it (#64)", async () => {
  // 0.1 rps: a 30-token bucket (300 s of carryover) whose bulk share is
  // 27, so a handful of players is enough to over-subscribe it.
  const RATE = 0.1;
  const CAP = RATE * 300;
  const BULK_CAP = Math.floor(CAP * 0.9);
  const TICK_MS = 5 * 60_000;
  await db.query("delete from job");
  await freshenCards(NOW);
  try {
    const ALPHA = "0289PYLQGRJCUV";
    for (let i = 0; i < 100; i++)
      await addPlayer(`#QQ${ALPHA[Math.floor(i / 14)]}${ALPHA[i % 14]}`);
    await db.query(
      "update budget_state set rate_per_sec = $1, tokens = $2, settled_at = $3",
      [RATE, CAP, NOW],
    );
    const queuedBulk = async () =>
      (
        await db.query(
          "select count(*)::int as n from job where status = 'queued' and lane = 'bulk'",
        )
      ).rows[0].n;
    const at = (k) => new Date(NOW.getTime() + k * TICK_MS);
    // Two hours of ticks with no collector leasing anything: queued plus
    // planned never passes one tick's bulk allowance.
    for (let k = 0; k < 24; k++) {
      const r = await tickOnce(db, at(k));
      assert.ok(
        r.queuedBulk + r.jobs.length <= BULK_CAP,
        `tick ${k}: ${r.queuedBulk} queued + ${r.jobs.length} planned, past one tick's allowance of ${BULK_CAP}`,
      );
      assert.ok((await queuedBulk()) <= BULK_CAP);
    }
    // The fleet returns and drains what is queued before each tick. What
    // it is handed in the recovery hour - the backlog, then every tick's
    // new rows - stays within what the bucket allows in an hour: its
    // carryover plus an hour's accrual.
    let handed = await queuedBulk();
    for (let k = 24; k < 36; k++) {
      await db.query(
        "update job set status = 'done', done_at = now() where status = 'queued'",
      );
      const r = await tickOnce(db, at(k));
      assert.ok(r.queuedBulk + r.jobs.length <= BULK_CAP, `recovery tick ${k}`);
      handed += r.inserted;
    }
    assert.ok(
      handed <= CAP + RATE * 3600,
      `recovery hour: ${handed} jobs handed to the fleet, past the bucket's ${CAP + RATE * 3600}`,
    );
  } finally {
    await db.query("delete from job");
    await db.query("update budget_state set rate_per_sec = 1");
  }
});

test("the tick charges the bucket only for the rows it inserted (#64)", async () => {
  await db.query("delete from job");
  await freshenCards(NOW);
  try {
    await addPlayer("#CCC00002");
    await addPlayer("#CCC00008");
    // One subject the planner will pick already has a queued live job:
    // the enqueue upgrades nothing and inserts nothing, so it is free.
    await db.query(
      `insert into job (endpoint, entity_key, lane) values ('player', '#CCC00002', 'live')`,
    );
    await setTokens(100);
    const r = await tickOnce(db, NOW);
    assert.equal(r.jobs.length, 4, "both players, both endpoints");
    assert.equal(r.inserted, 3);
    const {
      rows: [b],
    } = await db.query("select tokens::float as tokens from budget_state");
    assert.equal(b.tokens, 97, "100 settled, three inserted rows charged");
  } finally {
    await db.query("delete from job");
  }
});

// Review 2026-09-27 §2.6 (#69). last_planned_at is stamped at plan time
// and a failed fetch left it standing, so an anchored daily read that
// errored at the 10:05Z tick waited for the next board day. A non-404
// error now owes a retry at 15, 30, then 60 minutes.
test("an error at the 10:05Z tick is re-planned within the same board day (#69)", async () => {
  const at = (iso) => new Date(iso);
  const {
    rows: [gw],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'sched-retry-gw', '127.0.0.2', 'active') returning gateway_id`,
    [accountId],
  );
  const fail = (endpoint, fetchedAt, httpStatus = 503) =>
    processResult(db, {
      v: 1,
      job: { endpoint, entity_key: "GLOBAL", lane: "bulk" },
      gateway_id: gw.gateway_id,
      fetched_at: fetchedAt,
      status: "error",
      http_status: httpStatus,
      error: { kind: "http" },
    });
  const tick = async (iso) => {
    await setTokens(100);
    const r = await planTick(db, at(iso));
    return {
      events: r.jobs.some((j) => j.endpoint === "events"),
      retried: r.retried,
    };
  };
  // Yesterday's board day was read; today's opens at 10:00Z.
  await freshenCards(at("2026-09-04T09:00:00Z"));
  assert.deepEqual(await tick("2026-09-04T10:05:00Z"), {
    events: true,
    retried: 0,
  });
  // The read the 10:05Z tick planned fails: a CR maintenance break.
  assert.equal(
    (await fail("events", "2026-09-04T10:05:40Z")).outcome,
    "fetch_error",
  );
  assert.equal((await tick("2026-09-04T10:15:00Z")).events, false);
  assert.deepEqual(
    await tick("2026-09-04T10:21:00Z"),
    { events: true, retried: 1 },
    "retried 15 minutes after the error, not tomorrow",
  );
  assert.equal(
    (await tick("2026-09-04T10:26:00Z")).events,
    false,
    "once per stamp",
  );
  // It fails again: 30 minutes, then 60, then the board day's own rule.
  await fail("events", "2026-09-04T10:21:30Z");
  assert.equal((await tick("2026-09-04T10:50:00Z")).events, false);
  assert.equal((await tick("2026-09-04T10:52:00Z")).events, true);
  await fail("events", "2026-09-04T10:52:30Z");
  assert.equal((await tick("2026-09-04T11:50:00Z")).events, false);
  assert.equal((await tick("2026-09-04T11:53:00Z")).events, true);
  await fail("events", "2026-09-04T11:53:30Z");
  assert.equal(
    (await tick("2026-09-04T16:00:00Z")).events,
    false,
    "three tries, then the cadence",
  );
  // The next board day's read is the cadence's, so a failure there earns
  // its own three retries.
  await freshenCards(at("2026-09-05T09:00:00Z"));
  assert.deepEqual(await tick("2026-09-05T10:05:00Z"), {
    events: true,
    retried: 0,
  });
  await fail("events", "2026-09-05T10:05:40Z");
  assert.deepEqual(await tick("2026-09-05T10:21:00Z"), {
    events: true,
    retried: 1,
  });

  // A 404 is the not-found hold's, never a retry.
  await fail("events", "2026-09-05T10:21:40Z", 404);
  const {
    rows: [row],
  } = await db.query(
    `select retry_at, retry_tries from poll_state
     where subject_tag = 'GLOBAL' and endpoint = 'events'`,
  );
  assert.deepEqual(row, { retry_at: null, retry_tries: 1 });
});

// Review 2026-09-27 §4.5 (#69): a +15% jitter on the 120-minute ceiling
// let a battle log wait 138 minutes against "never passes two hours".
test("a battle log's jittered wait never passes the session ceiling (#69)", () => {
  const tags = Array.from({ length: 400 }, (_, i) => `#P${i.toString(36)}`);
  const up = tags.find((t) => jitterFactor(t, "player_battlelog") > 1.1);
  const down = tags.find((t) => jitterFactor(t, "player_battlelog") < 0.9);
  assert.ok(up && down);
  const minutes = (tag, streak) =>
    dueAfterMs({
      subject_tag: tag,
      endpoint: "player_battlelog",
      empty_streak: streak,
    }) / 60_000;
  for (const tag of tags)
    assert.ok(minutes(tag, 9) <= SESSION_CEILING_MINUTES, tag);
  assert.equal(minutes(up, 9), SESSION_CEILING_MINUTES, "clamped");
  assert.ok(minutes(down, 9) < SESSION_CEILING_MINUTES, "de-phased below");
  // Below the ceiling the jitter still spreads a cohort both ways.
  assert.ok(minutes(up, 0) > SESSION_FOLLOWUP_MINUTES);
  assert.ok(minutes(down, 0) < SESSION_FOLLOWUP_MINUTES);
  // Other endpoints keep their jitter unclamped.
  const profile = dueAfterMs({ subject_tag: up, endpoint: "player" }) / 60_000;
  assert.ok(profile > 1440);
});

test("retired board poll states and retries cannot restart capture", async () => {
  const { RETIRED_RECORDING_ENDPOINTS } = await import("@elixir-mcp/contracts");
  for (const endpoint of RETIRED_RECORDING_ENDPOINTS) {
    await setState(
      endpoint === "rankings_pol_season" ? "2022-10" : "global",
      endpoint,
    );
  }
  await db.query(
    "update poll_state set retry_at = $1 where endpoint = any($2::text[])",
    [min(60), RETIRED_RECORDING_ENDPOINTS],
  );
  await addPlayer("#20JJJ2CCRU", { clan: "#J2RGCRVG" });
  await setTokens(1000);
  const { jobs } = await planTick(db, NOW);
  assert.equal(
    jobs.some((j) => RETIRED_RECORDING_ENDPOINTS.includes(j.endpoint)),
    false,
  );
  assert.ok(jobs.some((j) => j.endpoint === "player_battlelog"));
  assert.ok(jobs.some((j) => j.endpoint === "clan"));
  assert.ok(jobs.some((j) => j.endpoint === "cards"));
});

test("a retained player profile still respects the API's 404 hold", async () => {
  const tag = "#20JJJ2CCRU";
  await addPlayer(tag);
  await setState(tag, "player", { planned: min(10) });
  const {
    rows: [gw],
  } = await db.query(
    `insert into gateway (owner_account_id,name,status)
    values ($1,'retained-404','active') returning gateway_id`,
    [accountId],
  );
  await db.query(
    `insert into collector_fetch_error (gateway_id,endpoint,entity_key,fetched_at,http_status,error_kind)
    values ($1,'player',$2,$3,404,'http')`,
    [gw.gateway_id, tag, min(9)],
  );
  await setTokens(100);
  const held = await planTick(db, NOW);
  assert.equal(
    held.jobs.some((j) => j.endpoint === "player" && j.entity_key === tag),
    false,
  );
  assert.equal(held.notFoundHeld, 2, "profile and battlelog respect the hold");
  await setTokens(100);
  const next = await planTick(db, new Date(NOW.getTime() + 86400_000));
  assert.equal(
    next.jobs.some((j) => j.endpoint === "player" && j.entity_key === tag),
    true,
  );
});

test("an observed race rollover owes one log closure read within the existing bulk budget", async () => {
  const clan = "#2PQRJ8LV";
  await db.query("delete from job");
  await db.query(
    "insert into clan(clan_tag) values($1) on conflict do nothing",
    [clan],
  );
  await db.query(
    "insert into recording(subject_type,subject_tag,requested_by) values('clan',$1,$2)",
    [clan, accountId],
  );
  await freshenCards(NOW);
  for (const endpoint of ["clan", "currentriverrace"])
    await setState(clan, endpoint, { admitted: NOW, planned: NOW });
  await setState(clan, "riverracelog", {
    admitted: min(180),
    planned: min(180),
  });
  await db.query(
    `insert into war_week(clan_tag,season_id,section_index,is_colosseum,started_observed_at)
    values($1,136,2,false,$2),($1,136,3,true,$3)`,
    [clan, min(14 * 1440), min(7 * 1440)],
  );
  const logDue = async (at = NOW) =>
    (await eligibleNow(db, at)).filter(
      (r) => r.subject_tag === clan && r.endpoint === "riverracelog",
    );
  assert.equal(
    (await logDue()).length,
    0,
    "an unfinished race or the clock alone does not accelerate log capture",
  );
  await db.query(
    `insert into war_week(clan_tag,season_id,section_index,is_colosseum,started_observed_at)
    values($1,137,0,false,$2)`,
    [clan, new Date(NOW.getTime() + 60_000)],
  );
  assert.equal(
    (await logDue()).length,
    0,
    "a future observation is not a rollover",
  );
  await db.query(
    "update war_week set started_observed_at=$2 where clan_tag=$1 and season_id=137 and section_index=0",
    [clan, min(2)],
  );
  assert.equal(
    (await logDue()).length,
    1,
    "the newer observed race makes its unfinished predecessor's log due",
  );
  assert.equal(
    (await logDue()).length,
    1,
    "the status read never consumes the obligation",
  );
  await setTokens(1);
  assert.equal(
    (await planTick(db, NOW)).jobs.length,
    0,
    "the live reserve is preserved",
  );
  await setTokens(2);
  const first = await planTick(db, NOW);
  assert.deepEqual(first.jobs, [
    { endpoint: "riverracelog", entity_key: clan, lane: "bulk" },
  ]);
  assert.equal(
    (await logDue()).length,
    0,
    "planning suppresses another catch-up for that observed rollover",
  );
  const retryAt = new Date(NOW.getTime() + 15 * 60_000);
  await db.query(
    "update poll_state set retry_at=$2, retry_tries=1 where subject_tag=$1 and endpoint='riverracelog'",
    [clan, retryAt],
  );
  assert.equal(
    (await logDue()).length,
    0,
    "failed catch-up waits for its retry time",
  );
  const retried = await logDue(retryAt);
  assert.equal(retried.length, 1);
  assert.equal(
    retried[0].retry,
    true,
    "the existing bounded retry path handles failure",
  );
  await db.query(
    "update poll_state set retry_at=null, retry_tries=0 where subject_tag=$1 and endpoint='riverracelog'",
    [clan],
  );
  await setState(clan, "riverracelog", { admitted: min(1), planned: min(1) });
  assert.equal(
    (await logDue()).length,
    0,
    "a log read after the observation has already served the catch-up",
  );
  await setState(clan, "riverracelog", {
    admitted: min(180),
    planned: min(180),
  });
  await db.query(
    "update war_week set finished_observed_at=$2 where clan_tag=$1 and season_id=136 and section_index=3",
    [clan, min(1)],
  );
  assert.equal(
    (await logDue()).length,
    0,
    "an older incomplete history row does not trigger a read when the immediate predecessor is closed",
  );
  await db.query(
    "update war_week set finished_observed_at=null where clan_tag=$1 and season_id=136 and section_index=3",
    [clan],
  );
  await db.query(
    "update recording set status='stopped' where subject_type='clan' and subject_tag=$1",
    [clan],
  );
  assert.equal(
    (await logDue()).length,
    0,
    "retired recording never gains automatic closure work",
  );
});

test("a race 404 at the season roll keeps the race's cadence; a lasting one is held", async () => {
  // 2026-10-05: the last race admitted at 09:37:40Z, every race answered
  // 404 from 10:00 to 10:09Z, and the daily hold kept them all unread
  // until the next day. A 404 soon after a recorded race is the roll gap.
  const rolled = "#8PQRJ8LV";
  const raceless = "#LPQRJ8LV";
  const notFoundAt = new Date("2026-10-05T10:05:00Z");
  const at = new Date("2026-10-05T10:40:00Z");
  await db.query("delete from job");
  const {
    rows: [gateway],
  } = await db.query(
    "insert into gateway(owner_account_id,name,status) values($1,'season-roll-gap','active') returning gateway_id",
    [accountId],
  );
  for (const [clan, admitted] of [
    [rolled, new Date("2026-10-05T09:37:40Z")],
    [raceless, new Date("2026-10-03T09:37:40Z")],
  ]) {
    await db.query("insert into clan(clan_tag) values($1)", [clan]);
    await db.query(
      "insert into recording(subject_type,subject_tag,requested_by) values('clan',$1,$2)",
      [clan, accountId],
    );
    await setState(clan, "currentriverrace", { admitted, planned: notFoundAt });
    await db.query(
      "insert into collector_fetch_error(gateway_id,endpoint,entity_key,fetched_at,http_status,error_kind) values($1,'currentriverrace',$2,$3,404,'http')",
      [gateway.gateway_id, clan, notFoundAt],
    );
  }
  const raceDue = async (clan, now) =>
    (await eligibleNow(db, now)).some(
      (row) => row.subject_tag === clan && row.endpoint === "currentriverrace",
    );
  assert.equal(
    await raceDue(rolled, at),
    true,
    "a race 404 25 minutes after the last race is read again on cadence",
  );
  assert.equal(
    await raceDue(raceless, at),
    false,
    "a clan with no race for two days keeps the daily hold",
  );
  // The gap outlasts six hours: the race is gone, and the hold applies.
  await db.query(
    "insert into collector_fetch_error(gateway_id,endpoint,entity_key,fetched_at,http_status,error_kind) values($1,'currentriverrace',$2,$3,404,'http')",
    [gateway.gateway_id, rolled, new Date("2026-10-05T15:40:00Z")],
  );
  await setState(rolled, "currentriverrace", {
    admitted: new Date("2026-10-05T09:37:40Z"),
    planned: new Date("2026-10-05T15:40:00Z"),
  });
  assert.equal(
    await raceDue(rolled, new Date("2026-10-05T16:40:00Z")),
    false,
    "a 404 six hours after the last race is held for the day",
  );
});

test("an unfinished recorded colosseum owes one post-season log check while current race is 404", async () => {
  const clan = "#9PQRJ8LV";
  const roll = new Date("2026-10-05T10:00:00Z");
  const after = new Date("2026-10-05T10:08:00Z");
  const prior = new Date("2026-10-05T07:07:40Z");
  await db.query("delete from job");
  await ensureSeason(db, "2026-09");
  await db.query("insert into clan(clan_tag) values($1)", [clan]);
  await db.query(
    "insert into recording(subject_type,subject_tag,requested_by) values('clan',$1,$2)",
    [clan, accountId],
  );
  await freshenCards(after);
  await setState(clan, "clan", { admitted: after, planned: after });
  await setState(clan, "currentriverrace", { admitted: prior, planned: after });
  await setState(clan, "riverracelog", { admitted: prior, planned: prior });
  const {
    rows: [gateway],
  } = await db.query(
    "insert into gateway(owner_account_id,name,status) values($1,'rollover-standby','active') returning gateway_id",
    [accountId],
  );
  await db.query(
    "insert into collector_fetch_error(gateway_id,endpoint,entity_key,fetched_at,http_status,error_kind) values($1,'currentriverrace',$2,$3,404,'http')",
    [gateway.gateway_id, clan, after],
  );
  const logDue = async (at = after) =>
    (await eligibleNow(db, at)).filter(
      (row) => row.subject_tag === clan && row.endpoint === "riverracelog",
    );
  assert.equal(
    (await logDue()).length,
    0,
    "the calendar without an observed race creates no closure work",
  );
  await db.query(
    "insert into war_week(clan_tag,season_id,section_index,is_colosseum,started_observed_at) values($1,136,3,true,'2026-09-28T10:03:00Z')",
    [clan],
  );
  assert.equal(
    (await logDue(new Date(roll.getTime() - 1))).length,
    0,
    "never before the nominal season end",
  );
  assert.equal(
    (await logDue()).length,
    1,
    "a recorded unfinished colosseum owes a log check despite current-race standby",
  );
  assert.equal((await logDue()).length, 1, "reading eligibility is pure");
  assert.equal(
    (await eligibleNow(db, after)).some(
      (row) => row.subject_tag === clan && row.endpoint === "currentriverrace",
    ),
    false,
    "the current-race 404 hold remains intact",
  );
  await db.query("update budget_state set tokens=1, settled_at=$1", [after]);
  assert.equal(
    (await planTick(db, after)).jobs.length,
    0,
    "preserves the live reserve",
  );
  await db.query("update budget_state set tokens=2, settled_at=$1", [after]);
  assert.deepEqual((await planTick(db, after)).jobs, [
    { endpoint: "riverracelog", entity_key: clan, lane: "bulk" },
  ]);
  assert.equal(
    (await logDue()).length,
    0,
    "one planned post-season check suppresses another",
  );
  const {
    rows: [week],
  } = await db.query(
    "select finished_observed_at from war_week where clan_tag=$1",
    [clan],
  );
  assert.equal(
    week.finished_observed_at,
    null,
    "planning never fabricates closure",
  );
  await setState(clan, "riverracelog", { admitted: after, planned: prior });
  assert.equal(
    (await logDue()).length,
    0,
    "a post-boundary admission already served the check",
  );
  await setState(clan, "riverracelog", { admitted: prior, planned: prior });
  await db.query(
    "update war_week set finished_observed_at=$2 where clan_tag=$1",
    [clan, after],
  );
  assert.equal(
    (await logDue()).length,
    0,
    "a closed colosseum owes no extra check",
  );
  await db.query(
    "update war_week set finished_observed_at=null, is_colosseum=false where clan_tag=$1",
    [clan],
  );
  assert.equal(
    (await logDue()).length,
    0,
    "an ordinary week never creates a season-end check",
  );
  await db.query("update war_week set is_colosseum=true where clan_tag=$1", [
    clan,
  ]);
  await db.query("update recording set status='stopped' where subject_tag=$1", [
    clan,
  ]);
  assert.equal(
    (await logDue()).length,
    0,
    "stopped recordings remain excluded",
  );
});
