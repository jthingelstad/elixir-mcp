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
import { shapeDays } from "../src/routes/battle-activity.mjs";

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
  await db.query(
    `insert into player_activity
       (player_tag, computed_at, window_days, half_life_days, rhythm, rhythm_weight,
        rhythm_battles, days, not_recorded_days, recorded_from, first_battle_at,
        last_battle_at, battles_28d)
     values ($1, '2026-09-13T05:30:00Z', 365, 28, $2::jsonb, 2.5, 3,
             '{"2026-09-08": 3}'::jsonb, '["2026-09-06"]'::jsonb,
             '2026-09-03T12:00:00Z', '2026-09-08T14:30:00Z', '2026-09-08T15:10:00Z', 3)`,
    [TAG, JSON.stringify(new Array(168).fill(0))],
  );
});
after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.end();
});

test("shapeDays: a year ending on the histogram's day; not recorded before recording and where marked, zero only where recorded", () => {
  const days = shapeDays({
    computed_at: new Date("2026-09-13T05:30:00Z"),
    window_days: 10,
    recorded_from: new Date("2026-09-08T12:00:00Z"),
    days: { "2026-09-09": 4, "2026-09-05": 1 },
    not_recorded_days: ["2026-09-11"],
  });
  assert.equal(days.length, 10);
  assert.equal(days[0].day, "2026-09-04");
  assert.equal(days.at(-1).day, "2026-09-13");
  const by = Object.fromEntries(days.map((d) => [d.day, d]));
  assert.deepEqual(by["2026-09-05"], {
    day: "2026-09-05",
    battles: 1,
    status: "not_recorded",
  });
  assert.equal(by["2026-09-08"].status, "recorded", "the day recording began");
  assert.deepEqual(by["2026-09-09"], {
    day: "2026-09-09",
    battles: 4,
    status: "recorded",
  });
  assert.equal(by["2026-09-10"].status, "recorded");
  assert.equal(by["2026-09-10"].battles, 0, "watched, nothing played");
  assert.equal(by["2026-09-11"].status, "not_recorded", "a marked day");
  assert.equal(shapeDays(null).length, 0);
});

test("GET: your own player's year, oldest first, statuses as the rules say", async () => {
  const r = await get(`/api/me/battle-activity/${TAG.slice(1)}`);
  assert.equal(r.statusCode, 200, r.body);
  const body = data(r);
  assert.equal(body.player_tag, TAG);
  assert.equal(body.computed_at, "2026-09-13T05:30:00.000Z");
  assert.equal(body.days.length, 365);
  assert.equal(body.days.at(-1).day, "2026-09-13");
  const by = Object.fromEntries(body.days.map((d) => [d.day, d]));
  assert.equal(by["2026-09-01"].status, "not_recorded");
  assert.equal(by["2026-09-06"].status, "not_recorded");
  assert.deepEqual(by["2026-09-08"], {
    day: "2026-09-08",
    battles: 3,
    status: "recorded",
  });
  assert.equal(by["2026-09-10"].battles, 0);
  assert.equal(by["2026-09-10"].status, "recorded");
  assert.equal(body.rhythm.length, 168);
  assert.equal(body.rhythm_weight, 2.5);
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
