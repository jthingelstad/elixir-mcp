/**
 * The battle-activity route (0084): the nightly row for one of the
 * account's own players, shaped as a year of UTC days in which a day
 * before recording began or marked by the recorder is `not_recorded`,
 * never zero.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { createSession } from "@elixir-mcp/auth";
import { makeHandler } from "../src/handler.mjs";
import { shapeDays, coveredDays } from "../src/routes/battle-activity.mjs";

const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_activity_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);
let db, handler, cookie, person;
const TAG = "#2PP0V90Y";
const NEW_TAG = "#8QU2PJ8C"; // claimed, no row yet
const OTHER_TAG = "#PPRJ8V0L"; // somebody else's

const get = (path, session = cookie) =>
  handler({
    rawPath: path,
    requestContext: { http: { method: "GET" } },
    headers: { cookie: session, "x-elixir-client": "web" },
  });
const data = (r) => JSON.parse(r.body);

before(async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();
  await migrate({
    databaseUrl,
    migrationsDir: new URL("../../../db/migrations", import.meta.url).pathname,
  });
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  person = (
    await db.query(
      "insert into account(email_hash,status,role) values ('activity-person','approved','member') returning account_id",
    )
  ).rows[0].account_id;
  const session = await createSession(db, {
    secret: "test",
    accountId: person,
    emailHash: "activity-person",
  });
  cookie = `__Host-elixir_session=${session.token}`;
  handler = makeHandler({ databaseUrl, secret: "test" });
  for (const tag of [TAG, NEW_TAG, OTHER_TAG])
    await db.query(
      `insert into player (player_tag, name) values ($1, 'Seed') on conflict do nothing`,
      [tag],
    );
  for (const [tag, primary] of [
    [TAG, true],
    [NEW_TAG, false],
  ])
    await db.query(
      `insert into claim (account_id, player_tag, status, is_primary, relationship)
       values ($1, $2, 'unverified', $3, $4)`,
      [person, tag, primary, primary ? "primary" : "alt"],
    );
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by, created_at)
     values ('player', $1, $2, '2026-09-03T12:00:00Z')`,
    [NEW_TAG, person],
  );
  const gatewayId = (
    await db.query(
      `insert into gateway (owner_account_id, name, static_ip, status)
       values ($1, 'Test', '203.0.113.9', 'active') returning gateway_id`,
      [person],
    )
  ).rows[0].gateway_id;
  // The record of watching: admitted battle-log reads. Two in July (the
  // import era), two in September; nothing between.
  for (const at of [
    "2026-07-08T10:00:00Z",
    "2026-07-09T10:00:00Z",
    "2026-09-08T16:00:00Z",
    "2026-09-13T04:00:00Z",
  ])
    await db.query(
      `insert into api_receipt (endpoint, entity_key, fetched_at, payload_hash, gateway_id, admission)
       values ('player_battlelog', $1, $2, 'h', $3, 'admitted')`,
      [TAG, at, gatewayId],
    );
  await db.query(
    `insert into player_activity
       (player_tag, computed_at, window_days, not_recorded_days, recorded_from,
        first_battle_at, last_battle_at, battles_28d)
     values ($1, '2026-09-13T05:30:00Z', 365, '{2026-09-11}'::date[],
             '2026-09-03T12:00:00Z', '2026-05-14T19:49:00Z', '2026-09-08T15:10:00Z', 3)`,
    [TAG],
  );
  // The year's counts are the daily rollup (0123), not a column.
  await db.query(
    `insert into player_daily_battle_rollup (player_tag, day, mode_group, game_mode_id, wins, losses, draws, battles_captured)
     values ($1, '2026-09-08', 'ladder', 0, 2, 1, 0, 3),
            ($1, '2026-05-14', 'ladder', 0, 4, 0, 0, 4),
            ($1, '2026-09-11', 'ladder', 0, 1, 0, 0, 1),
            ($1, '2026-09-11', 'ranked', 0, 0, 1, 0, 1)`,
    [TAG],
  );
});
after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.end();
});

test("coveredDays: a log read covers its day and the two before it", () => {
  const c = coveredDays(["2026-09-10"]);
  assert.deepEqual([...c].sort(), ["2026-09-08", "2026-09-09", "2026-09-10"]);
});

test("shapeDays: battles always drawn; zero only where a log read covers the day; hatched elsewhere; partial on a marked day with battles", () => {
  const days = shapeDays(
    {
      computed_at: new Date("2026-09-13T05:30:00Z"),
      window_days: 10,
      days: {
        "2026-09-09": [4, 3, 1],
        "2026-09-05": 1,
        "2026-09-12": [2, 0, 0],
      },
      not_recorded_days: ["2026-09-12"],
    },
    ["2026-09-09", "2026-09-13"],
  );
  assert.equal(days.length, 10);
  assert.equal(days[0].day, "2026-09-04");
  assert.equal(days.at(-1).day, "2026-09-13");
  const by = Object.fromEntries(days.map((d) => [d.day, d]));
  assert.equal(by["2026-09-04"].status, "not_recorded", "no read, no battle");
  assert.deepEqual(
    by["2026-09-05"],
    { day: "2026-09-05", battles: 1, status: "recorded" },
    "a battle is drawn however it arrived; a bare count carries no tallies",
  );
  assert.deepEqual(
    by["2026-09-09"],
    { day: "2026-09-09", battles: 4, wins: 3, losses: 1, status: "recorded" },
    "a rebuilt day carries its wins and losses",
  );
  assert.equal(by["2026-09-06"].status, "not_recorded", "nothing, unwatched");
  assert.equal(
    by["2026-09-07"].status,
    "recorded",
    "the 09-09 read reaches back two days",
  );
  assert.equal(by["2026-09-07"].battles, 0, "watched, nothing played");
  assert.equal(by["2026-09-08"].status, "recorded");
  assert.equal(
    by["2026-09-10"].status,
    "not_recorded",
    "between reads, unwatched",
  );
  assert.equal(
    by["2026-09-11"].status,
    "recorded",
    "the 09-13 read reaches it",
  );
  assert.deepEqual(by["2026-09-12"], {
    day: "2026-09-12",
    battles: 2,
    wins: 0,
    losses: 0,
    status: "recorded",
    partial: true,
  });
  assert.equal(shapeDays(null).length, 0);
});

test("GET: your own player's year, oldest first, coverage from the log reads", async () => {
  const r = await get(`/api/me/battle-activity/${TAG.slice(1)}`);
  assert.equal(r.statusCode, 200, r.body);
  const body = data(r);
  assert.equal(body.player_tag, TAG);
  assert.equal(body.computed_at, "2026-09-13T05:30:00.000Z");
  assert.equal(body.days.length, 365);
  assert.equal(body.days.at(-1).day, "2026-09-13");
  const by = Object.fromEntries(body.days.map((d) => [d.day, d]));
  assert.equal(by["2026-05-13"].status, "not_recorded", "nothing, no read");
  assert.deepEqual(
    by["2026-05-14"],
    { day: "2026-05-14", battles: 4, wins: 4, losses: 0, status: "recorded" },
    "an imported appearance is drawn",
  );
  assert.equal(by["2026-06-01"].status, "not_recorded", "no read covers June");
  assert.equal(
    by["2026-07-07"].status,
    "recorded",
    "the 07-09 read reaches back",
  );
  assert.equal(by["2026-07-07"].battles, 0, "watched in July, nothing played");
  assert.equal(by["2026-07-10"].status, "not_recorded", "after the July reads");
  assert.equal(by["2026-09-06"].status, "recorded", "the 09-08 read covers it");
  assert.deepEqual(by["2026-09-08"], {
    day: "2026-09-08",
    battles: 3,
    wins: 2,
    losses: 1,
    status: "recorded",
  });
  assert.equal(by["2026-09-09"].status, "not_recorded", "between reads");
  assert.deepEqual(
    by["2026-09-11"],
    {
      day: "2026-09-11",
      battles: 2,
      wins: 1,
      losses: 1,
      status: "recorded",
      partial: true,
    },
    "a marked day with battles is partial",
  );
  assert.equal(by["2026-09-12"].status, "recorded");
  assert.equal(body.log_reads_from, "2026-07-08");
  assert.equal(body.log_read_days, 4);
  assert.equal("rhythm" in body, false, "the rhythm retired 2026-09-19");
  assert.equal(body.not_recorded_days, 1);
  // The hash form is accepted too (a pasted %23 link).
  const r2 = await get(`/api/me/battle-activity/%23${TAG.slice(1)}`);
  assert.equal(r2.statusCode, 200);
});

test("GET: a claimed player with no row yet says not computed, with recorded_from from the recording", async () => {
  const r = await get(`/api/me/battle-activity/${NEW_TAG.slice(1)}`);
  assert.equal(r.statusCode, 200);
  const body = data(r);
  assert.equal(body.computed_at, null);
  assert.deepEqual(body.days, []);
  assert.equal(body.recorded_from, "2026-09-03T12:00:00.000Z");
});

test("GET: not yours is 404, a bad tag 400, no session 401", async () => {
  assert.equal(
    (await get(`/api/me/battle-activity/${OTHER_TAG.slice(1)}`)).statusCode,
    404,
  );
  assert.equal(
    data(await get(`/api/me/battle-activity/${OTHER_TAG.slice(1)}`)).error,
    "not_yours",
  );
  assert.equal((await get(`/api/me/battle-activity/nope!`)).statusCode, 400);
  assert.equal(
    (await get(`/api/me/battle-activity/${TAG.slice(1)}`, "")).statusCode,
    401,
  );
});
