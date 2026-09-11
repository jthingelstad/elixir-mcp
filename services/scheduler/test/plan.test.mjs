import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import {
  planTick,
  CADENCE,
  yieldCadenceMinutes,
  lossBoundMinutes,
  inLossBoundArm,
  jitterFactor,
  LOSS_SAFETY,
  LOG_CAPACITY,
  READ_CAP_MINUTES,
  eligibleNow,
  queueSummary,
} from "../src/plan.mjs";

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

test("new subject seeds both player endpoints plus the followed clan", async () => {
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
    admitted: min(1),
    planned: min(1),
  });
  await setState("#20JJJ2CCRU", "player", {
    admitted: min(1),
    planned: min(1),
  });
  await setState("#J2RGCRVG", "clan", {
    admitted: min(10),
    planned: min(10),
  });
  await setTokens(100);
  const { jobs } = await planTick(db, NOW);
  assert.equal(jobs.length, 0, "10 minutes since clan poll: not yet due");

  // 18, not 16. Cadences carry a stable per-subject jitter of +/-15%, so a
  // 15-minute heartbeat is due somewhere in [12.75, 17.25] depending on the
  // tag -- probing at 16 tested this tag's hash rather than the cadence. Both
  // probes now sit outside the band, which is what the test always meant.
  await setState("#J2RGCRVG", "clan", {
    admitted: min(18),
    planned: min(18),
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

test("yield cadence: harvest-target battlelog, stretched profiles, hinted war days", () => {
  const c = (row) => yieldCadenceMinutes(row);
  // Battlelog: poll when ~5 battles are expected.
  assert.equal(c({ endpoint: "player_battlelog", yield_bph: null }), 60);
  assert.equal(c({ endpoint: "player_battlelog", yield_bph: 0.01 }), 1440);
  assert.equal(c({ endpoint: "player_battlelog", yield_bph: 20 }), 15);
  assert.equal(
    Math.round(c({ endpoint: "player_battlelog", yield_bph: 1 })),
    300,
  );
  // Profiles ride the same signal. Active players take 480, not 120: the
  // projection is a daily snapshot and the 120m branch was 70% of profile
  // spend (2026-09-09 audit).
  assert.equal(c({ endpoint: "player", yield_bph: 0.005 }), 4320);
  assert.equal(c({ endpoint: "player", yield_bph: 2 }), 480);
  assert.equal(c({ endpoint: "player", yield_bph: 0.2 }), 1440);
  assert.equal(c({ endpoint: "player", yield_bph: null }), 480);
  // The borrowed battlelog signal wins over the profile row's own NULL.
  assert.equal(
    c({ endpoint: "player", yield_bph: null, activity_bph: 0.01 }),
    4320,
  );
  assert.equal(
    c({
      endpoint: "player",
      yield_bph: null,
      activity_bph: 0.01,
      directly_tracked: true,
    }),
    480,
    "a directly tracked player's profile has an eight-hour nominal cap",
  );
  // The payload names war days.
  assert.equal(c({ endpoint: "currentriverrace", hint: "training" }), 120);
  assert.equal(c({ endpoint: "currentriverrace", hint: "warDay" }), 30);
  assert.equal(c({ endpoint: "currentriverrace", hint: null }), 30);
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
// Production shapes from docs/FETCH-LOOP-AUDIT-2026-09-09.md, pinned.

test("loss-aware bound: the grinder shape, its TTL, and the NULL fallback", () => {
  const c = (row) => yieldCadenceMinutes(row, NOW);
  // #9U9QY99RY: 30 battles in 1.8h = 16.7 bph, while the EWMA (which only
  // ever sees 30 / interval) reads 3 bph and would wait 100 minutes.
  const grinder = {
    endpoint: "player_battlelog",
    yield_bph: 3,
    burst_bph: 16.7,
    burst_at: min(30),
  };
  assert.equal(Math.round(c({ ...grinder, burst_bph: null })), 100);
  assert.equal(Math.round(c(grinder)), 54);
  assert.equal(
    Math.round(lossBoundMinutes(grinder, NOW)),
    Math.round(((LOSS_SAFETY * LOG_CAPACITY) / 16.7) * 60),
  );
  // A burst older than 14 days no longer bounds anything.
  assert.equal(Math.round(c({ ...grinder, burst_at: min(15 * 1440) })), 100);
  // A slow player's burst never tightens below the rule (horizon 300h).
  assert.equal(c({ ...grinder, yield_bph: 0.1, burst_bph: 0.1 }), 1440);
  // The floor holds: 60 bph would want 15m from the bound too.
  assert.equal(c({ ...grinder, burst_bph: 60 }), 15);
  // The bound is a battlelog rule; profiles ignore it.
  assert.equal(c({ ...grinder, endpoint: "player", activity_bph: 3 }), 480);
});

test("reader cap: a low-activity friend polls hourly for a day after a read", () => {
  const c = (row) => yieldCadenceMinutes(row, NOW);
  // King Levy's shape: 3 battles/day -> 0.125 bph -> the 24h clamp, and
  // 23h stale at read time on 2026-09-09.
  const friend = { endpoint: "player_battlelog", yield_bph: 0.125 };
  assert.equal(c(friend), 1440);
  assert.equal(c({ ...friend, last_read_at: min(120) }), READ_CAP_MINUTES);
  assert.equal(c({ ...friend, last_read_at: min(25 * 60) }), 1440);
  // A cap never loosens a grinder's own tighter cadence.
  assert.equal(
    c({ endpoint: "player_battlelog", yield_bph: 20, last_read_at: min(1) }),
    15,
  );
});

test("the A/B arm is a stable hash split of about half the population", () => {
  const tags = Array.from({ length: 400 }, (_, i) => `#ARM${i.toString(36)}`);
  const treated = tags.filter((t) => inLossBoundArm(t, "half"));
  assert.ok(
    treated.length > 160 && treated.length < 240,
    `half arm holds ${treated.length} of 400`,
  );
  for (const t of tags)
    assert.equal(
      inLossBoundArm(t, "half"),
      jitterFactor(t, "player_battlelog") < 1,
      "the arm IS the jitter phase, so ab_yield can split receipts identically",
    );
  assert.ok(tags.every((t) => inLossBoundArm(t, "all")));
  assert.ok(tags.every((t) => !inLossBoundArm(t, "off")));
  assert.ok(tags.every((t) => !inLossBoundArm(t, undefined)));
});

async function stampSignals(tag, { burst, burstAt, readAt } = {}) {
  await db.query(
    `update poll_state set burst_bph = $2, burst_at = $3, last_read_at = $4
     where subject_tag = $1 and endpoint = 'player_battlelog'`,
    [tag, burst ?? null, burstAt ?? null, readAt ?? null],
  );
}

test("the loss bound makes a treated grinder due and leaves the control twin alone", async () => {
  await freshenCards(NOW);
  const tags = ["#G2RJ2L", "#G2RJ2P", "#G2RJ2Q", "#G2RJ2Y"]; // sorted
  for (const t of tags) {
    await addPlayer(t);
    // EWMA 3 bph -> 100m rule; last polled 70m ago: not due unbounded
    // (jitter floor 85m), due under the 54m bound (jitter ceiling 62m).
    await setState(t, "player_battlelog", {
      yieldBph: 3,
      admitted: min(70),
      planned: min(70),
    });
    await setState(t, "player", { admitted: min(1), planned: min(1) });
    await stampSignals(t, { burst: 16.7, burstAt: min(10) });
  }
  await setTokens(100);
  const off = await planTick(db, NOW, { arm: "off" });
  assert.deepEqual(off.jobs, [], "control: nobody is due at 70 minutes");
  assert.equal(off.bounded, 0);

  await setTokens(100);
  const all = await planTick(db, NOW, { arm: "all" });
  assert.deepEqual(
    all.jobs.map((j) => j.entity_key).sort(),
    tags,
    "treated: every grinder is due under the bound",
  );
  assert.equal(all.bounded, 4, "and each one is attributed to the bound");

  // Reset planning stamps and prove the half arm is exactly the hash split.
  for (const t of tags)
    await setState(t, "player_battlelog", {
      yieldBph: 3,
      admitted: min(70),
      planned: min(70),
    });
  for (const t of tags)
    await stampSignals(t, { burst: 16.7, burstAt: min(10) });
  await setTokens(100);
  const half = await planTick(db, NOW, { arm: "half" });
  assert.deepEqual(
    half.jobs.map((j) => j.entity_key).sort(),
    tags.filter((t) => inLossBoundArm(t, "half")).sort(),
  );
});

test("a read within the day makes a clamped friend due; an older read does not", async () => {
  await freshenCards(NOW);
  await addPlayer("#L2VY9P");
  await addPlayer("#L2VY9Y");
  for (const t of ["#L2VY9P", "#L2VY9Y"]) {
    await setState(t, "player_battlelog", {
      yieldBph: 0.125,
      admitted: min(180),
      planned: min(180),
    });
    await setState(t, "player", { admitted: min(1), planned: min(1) });
  }
  await stampSignals("#L2VY9P", { readAt: min(60) });
  await stampSignals("#L2VY9Y", { readAt: min(25 * 60) });
  await setTokens(100);
  const { jobs, readCapped } = await planTick(db, NOW, { arm: "off" });
  assert.deepEqual(
    jobs.map((j) => j.entity_key),
    ["#L2VY9P"],
    "read an hour ago: polled; read yesterday: still on the clamp",
  );
  assert.equal(readCapped, 1);
});

test("the profile row really borrows the battlelog signal now", async () => {
  await freshenCards(NOW);
  await addPlayer("#R0Y8UU");
  await addPlayer("#R0Y8VV");
  // Dormant: battlelog says 0.01 bph -> profile every 72h; polled 10h ago
  // it must NOT be due (it was, under the inert borrow: 480m).
  await setState("#R0Y8UU", "player_battlelog", {
    yieldBph: 0.01,
    admitted: min(1),
    planned: min(1),
  });
  await setState("#R0Y8UU", "player", {
    admitted: min(600),
    planned: min(600),
  });
  // Active: 1 bph -> 480m; polled 9h ago it is due, 7h ago it is not.
  await setState("#R0Y8VV", "player_battlelog", {
    yieldBph: 1,
    admitted: min(1),
    planned: min(1),
  });
  await setState("#R0Y8VV", "player", {
    admitted: min(540),
    planned: min(540),
  });
  await setTokens(100);
  const { jobs } = await planTick(db, NOW, { arm: "off" });
  assert.deepEqual(
    jobs.map((j) => `${j.endpoint}:${j.entity_key}`),
    ["player:#R0Y8VV"],
  );
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
