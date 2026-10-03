/** The factual game calendar, read back by game day from admitted observations. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../../../services/migrate/src/migrate.mjs";
import { projectEvents } from "../../ingest/src/game-events.mjs";
import { makeRegistry } from "../src/tools.mjs";
import { makeInvoker } from "../src/invoker.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_calendar_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

let db;
let invoke;

const T1 = "2026-09-11T10:00:00Z";
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
  const {
    rows: [owner],
  } = await db.query(
    `insert into account (email_hash, status, is_owner) values ('calendar-owner', 'approved', true) returning account_id`,
  );
  await projectEvents(db, {
    fetchedAt: T1,
    payload: [
      { eventTag: "#R8U2RCJ", title: "C.H.A.O.S", description: "modifiers" },
      { eventTag: "#R8UURVL", title: "Merge Tactics", description: null },
    ],
  });
  await projectEvents(db, {
    fetchedAt: "2026-09-12T10:00:00Z",
    payload: [
      { eventTag: "#R8UURVL", title: "Merge Tactics", description: null },
    ],
  });
  // A third sighting before 10:00Z with its receipt on record: UTC day
  // 2026-09-13, game day 2026-09-12 (3.17.0, game_days_seen).
  const {
    rows: [gw],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'calendar-gw', '127.0.0.1', 'active') returning gateway_id`,
    [owner.account_id],
  );
  // Every sighting comes from an admitted read, and game_events selects
  // by the reads inside its window (Gym #125), so each sighting above has
  // its receipt too.
  await db.query(
    `insert into api_receipt (endpoint, entity_key, fetched_at, payload_hash, gateway_id, admission)
     values ('events', 'GLOBAL', $2, 'h-events-1', $1, 'admitted'),
            ('events', 'GLOBAL', '2026-09-12T10:00:00Z', 'h-events-2', $1, 'admitted'),
            ('events', 'GLOBAL', '2026-09-13T04:00:00Z', 'h-events-3', $1, 'admitted')`,
    [gw.gateway_id, T1],
  );
  await projectEvents(db, {
    fetchedAt: "2026-09-13T04:00:00Z",
    payload: [
      { eventTag: "#R8UURVL", title: "Merge Tactics", description: null },
    ],
  });
  invoke = makeInvoker({
    db,
    account: {
      accountId: owner.account_id,
      isOwner: true,
      timezone: "UTC",
    },
    registry: makeRegistry(),
  });
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

test("game_events: what was on, by the days it was seen", async () => {
  const { body, isError } = await invoke("game_events", {
    from: "2026-09-11",
    to: "2026-09-12",
  });
  assert.equal(isError, false, JSON.stringify(body));
  const merge = body.events.find((e) => e.title === "Merge Tactics");
  const chaos = body.events.find((e) => e.title === "C.H.A.O.S");
  assert.deepEqual(merge.game_days_seen, ["2026-09-11", "2026-09-12"]);
  assert.deepEqual(chaos.game_days_seen, ["2026-09-11"]);
  assert.ok(!("days_seen" in merge), "4.0.0: the UTC-day list is gone");
  assert.equal(body.latest_sighting_day, "2026-09-13");
  assert.equal(body.first_sighting_day, "2026-09-11");
  assert.ok(
    body.notes.some((n) => n.startsWith("Sightings began 2026-09-11")),
    "the horizon note reads the table",
  );
  assert.equal(merge.running_on_latest_day, true);
  assert.equal(chaos.running_on_latest_day, false);
});

test("game_events: game_days_seen puts the same sightings on the game day grid, and the window says its season (3.17.0, call 6)", async () => {
  const { body, isError } = await invoke("game_events", {
    from: "2026-09-11",
    to: "2026-09-13",
  });
  assert.equal(isError, false, JSON.stringify(body));
  const merge = body.events.find((e) => e.title === "Merge Tactics");
  // Three UTC days; the 04:00Z read on the 13th is game day the 12th,
  // and the two reads without a receipt keep their UTC day.
  assert.deepEqual(merge.game_days_seen, ["2026-09-11", "2026-09-12"]);
  assert.ok(!("days_seen" in merge));
  assert.equal(merge.running_on_latest_day, true);
  assert.ok("season" in body.applied.window);
  assert.ok(Array.isArray(body.applied.window.crosses));
  assert.ok(body.notes.some((n) => /game_days_seen is the game days/.test(n)));
});
