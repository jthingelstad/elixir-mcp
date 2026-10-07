/** Private year read: canonical positives, comparable closed-day evidence,
 * independent of polling receipts and nightly projections. */
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
  const gatewayId = (
    await db.query(
      `insert into gateway (owner_account_id, name, static_ip, status)
       values ($1, 'Test', '203.0.113.9', 'active') returning gateway_id`,
      [person],
    )
  ).rows[0].gateway_id;
  // A fresh successful log receipt still cannot establish quiet days.
  await db.query(
    `insert into api_receipt (endpoint, entity_key, fetched_at, payload_hash, gateway_id, admission)
     values ('player_battlelog', $1, now(), 'h', $2, 'admitted')`,
    [TAG, gatewayId],
  );
  await db.query(
    `insert into player_activity (player_tag, computed_at, window_days, not_recorded_days, battles_28d)
     values ($1, now() - interval '20 days', 365, array[$2::date], 999)`,
    [TAG, day(-27)],
  );
  for (const [offset, count] of [
    [-90, 100],
    [-88, 100],
    [-30, 90],
    [-28, 93],
    [-26, 98],
    [1, 100],
  ])
    await db.query(
      `insert into player_snapshot_daily (player_tag, snapshot_date, observed_at, profile_observed_at, battle_count)
       values ($1, $2::date, $3, $3, $4)`,
      [
        TAG,
        day(offset),
        stamp(offset, offset === -90 ? "23:59:59" : "00:00:00"),
        count,
      ],
    );
  await battles(TAG, -29, 3, "complete");
  await battles(TAG, -27, 2, "partial");
  await battles(TAG, -1, 1, "recent");
  await battles(TAG, 1, 1, "future");
});
after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.end();
});

const DAY = 86_400_000;
const today = Date.parse(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
const day = (offset) =>
  new Date(today + offset * DAY).toISOString().slice(0, 10);
const stamp = (offset, time = "12:00:00") => `${day(offset)}T${time}Z`;
async function battles(tag, offset, n, prefix) {
  for (let i = 0; i < n; i++) {
    const id = `${prefix}-${i}`;
    await db.query(
      `insert into battle (battle_id,battle_time,type,type_class) values ($1,$2,'PvP','pvp')`,
      [id, stamp(offset)],
    );
    await db.query(
      `insert into battle_participant (battle_id,player_tag,side,battle_time,type,type_class,outcome)
      values ($1,$2,0,$3,'PvP','pvp',$4)`,
      [id, tag, stamp(offset), i % 2 ? "loss" : "win"],
    );
  }
}
const byDay = (body) => Object.fromEntries(body.days.map((d) => [d.day, d]));
const interval = (from, to, expected = 0, captured = expected) => ({
  observed_from: from,
  observed_to: to,
  expected_battles: expected,
  captured_battles: captured,
  is_complete: expected >= 0 && expected === captured,
});

test("year boundaries, leap day, open day, gaps and noncomparable intervals use the shared evidence contract", () => {
  const row = {
    as_of: "2025-01-01T12:00:00Z",
    days: { "2024-12-31": [2, 1, 1] },
    window_days: 365,
  };
  const days = shapeDays(row, [
    interval("2024-12-29T23:59:59Z", "2025-01-01T00:00:00Z", 2),
  ]);
  assert.equal(days[0].day, "2024-01-03");
  assert.ok(days.some((d) => d.day === "2024-02-29"));
  const by = byDay({ days });
  assert.equal(by["2024-12-30"].coverage, "complete");
  assert.equal(by["2024-12-31"].battles, 2);
  assert.equal(by["2024-12-31"].coverage, "complete");
  assert.notEqual(
    by["2025-01-01"].coverage,
    "complete",
    "today is open even if an interval reaches its start",
  );
  const closed = {
    as_of: "2025-01-02T12:00:00Z",
    window_days: 2,
    days: { "2025-01-01": 3 },
  };
  for (const spans of [
    [],
    [interval("2025-01-01T00:00:00Z", "2025-01-02T00:00:00Z")],
    [interval("2024-12-31T23:59:59Z", "2025-01-02T00:00:00Z", 5, 3)],
    [interval("2024-12-31T23:59:59Z", "2025-01-02T00:00:00Z", -1, 3)],
    [
      interval("2024-12-31T23:59:59Z", "2025-01-01T10:00:00Z"),
      interval("2025-01-01T10:01:00Z", "2025-01-02T00:00:00Z"),
    ],
  ]) {
    const d = shapeDays(closed, spans)[0];
    assert.equal(
      d.battles,
      3,
      "positive evidence survives every coverage state",
    );
    assert.equal(d.status, "recorded");
    assert.equal(d.partial, true);
    assert.notEqual(d.coverage, "complete");
  }
  const blank = shapeDays({ ...closed, days: {} }, [])[0];
  assert.equal(blank.status, "not_recorded");
  assert.equal(blank.coverage, "unknown");
  assert.deepEqual(shapeDays(null), []);
});

test("GET reads canonical activity through today despite a stale nightly row and fresh poll", async () => {
  const r = await get(`/api/me/battle-activity/${TAG.slice(1)}`);
  assert.equal(r.statusCode, 200, r.body);
  const body = data(r),
    by = byDay(body);
  assert.equal(body.player_tag, TAG);
  assert.equal(body.days.length, 365);
  assert.equal(body.days.at(-1).day, day(0));
  assert.equal(by[day(-89)].coverage, "complete");
  assert.equal(by[day(-89)].battles, 0);
  assert.equal(by[day(-29)].coverage, "complete");
  assert.equal(by[day(-29)].battles, 3);
  assert.equal(by[day(-27)].coverage, "partial");
  assert.equal(by[day(-27)].battles, 2);
  assert.equal(
    by[day(-1)].battles,
    1,
    "latest positive is not clipped by stale metadata",
  );
  assert.equal(
    by[day(-1)].coverage,
    "unknown",
    "fresh poll and future profile cannot cover yesterday",
  );
  assert.equal(by[day(0)].coverage, "unknown");
  assert.equal(by[day(0)].status, "not_recorded");
  assert.equal(body.computed_at.slice(0, 10), day(-20));
  assert.equal(body.as_of.slice(0, 10), day(0));
  assert.equal(
    (await get(`/api/me/battle-activity/%23${TAG.slice(1)}`)).statusCode,
    200,
  );
});

test("late canonical arrivals repair counts and intervals together, despite cached gap marks", async () => {
  await battles(TAG, -27, 3, "late");
  const d = byDay(data(await get(`/api/me/battle-activity/${TAG.slice(1)}`)))[
    day(-27)
  ];
  assert.equal(d.battles, 5);
  assert.equal(d.coverage, "complete");
  assert.equal(d.partial, undefined);
});

test("no nightly projection or observations gives unknown, while canonical positive activity appears immediately", async () => {
  const path = `/api/me/battle-activity/${NEW_TAG.slice(1)}`;
  let body = data(await get(path));
  assert.equal(body.computed_at, null);
  assert.equal(body.days.length, 365);
  assert.ok(
    body.days.every(
      (d) => d.coverage === "unknown" && d.status === "not_recorded",
    ),
  );
  assert.equal(body.recorded_from, "2026-09-03T12:00:00.000Z");
  await battles(NEW_TAG, -1, 2, "unprojected");
  body = data(await get(path));
  assert.equal(byDay(body)[day(-1)].battles, 2);
  assert.equal(byDay(body)[day(-1)].coverage, "unknown");
  assert.equal(body.computed_at, null);
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
  assert.equal((await get(`/api/me/battle-activity/%ZZ`)).statusCode, 404);
  assert.equal(
    (await get(`/api/me/battle-activity/${TAG.slice(1)}`, "")).statusCode,
    401,
  );
});
