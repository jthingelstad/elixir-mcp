import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../src/migrate.mjs";
import { snapshotDayCensus, snapshotRekey } from "../src/ops-series.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_series_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);

let db;

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${SCRATCH}`);
  await admin.end();
  await migrate({
    databaseUrl: SCRATCH_URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${SCRATCH} with (force)`);
  await admin.end();
});

async function snap(tag, day, kind, observedAt, trophies) {
  await db.query(
    `insert into player_snapshot_daily
       (player_tag, snapshot_date, snapshot_kind, observed_at, trophies, wins)
     values ($1, $2, $3, $4, $5, 100)`,
    [tag, day, kind, observedAt, trophies],
  );
}

test("snapshot_day_census reports movers and collisions per kind; snapshot_rekey applies exactly that", async () => {
  await db.query(
    `insert into player (player_tag) values ('#2PP0V9PP'), ('#2PP0V9QQ'), ('#2PP0V9RR'), ('#2PP0V9UU')`,
  );
  // #2PP0V9PP: a UTC-day row polled before 10:00Z moves to the previous game
  // day and collides with that day's own late poll; the later
  // observation (08:00Z on the 10th) wins, the 23:00Z row on the 9th is
  // dropped.
  await snap("#2PP0V9PP", "2026-09-09", "daily", "2026-09-09T23:00:00Z", 5000);
  await snap("#2PP0V9PP", "2026-09-10", "daily", "2026-09-10T08:00:00Z", 5010);
  // #2PP0V9PP: a row polled after the reset stays.
  await snap("#2PP0V9PP", "2026-09-11", "daily", "2026-09-11T15:00:00Z", 5020);
  // #2PP0V9QQ: two kinds polled before the reset, both move a day, nothing
  // waits on either key (a mover never collides with another mover: a
  // UTC day's movers all land on the day before it).
  await snap("#2PP0V9QQ", "2026-09-10", "daily", "2026-09-10T03:00:00Z", 6000);
  await snap(
    "#2PP0V9QQ",
    "2026-09-10",
    "pre_reset",
    "2026-09-10T03:30:00Z",
    6001,
  );
  // #2PP0V9RR: a mover onto a key that already has the day's own row;
  // the mover (09:00Z the next UTC morning) is the later observation
  // and replaces it.
  await snap("#2PP0V9RR", "2026-09-12", "daily", "2026-09-12T09:00:00Z", 7000);
  await snap("#2PP0V9RR", "2026-09-11", "daily", "2026-09-11T23:30:00Z", 7001);
  // A pre-0038 row without observed_at: stamped from the day's last
  // admitted profile receipt (08:00Z, so it moves); one with no receipt
  // stays where it is.
  await snap("#2PP0V9UU", "2026-09-01", "daily", null, 8000);
  await snap("#2PP0V9UU", "2026-08-30", "daily", null, 7990);
  const {
    rows: [account],
  } = await db.query(
    `insert into account (email_hash, status, is_owner, role) values ('series-owner', 'approved', true, 'owner')
     returning account_id`,
  );
  const {
    rows: [gw],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'series-gw', '127.0.0.1', 'active') returning gateway_id`,
    [account.account_id],
  );
  for (const [at, admission] of [
    ["2026-09-01T03:00:00Z", "admitted"],
    ["2026-09-01T08:00:00Z", "admitted"],
    ["2026-09-01T09:30:00Z", "rejected"],
  ])
    await db.query(
      `insert into api_receipt (endpoint, entity_key, fetched_at, payload_hash, gateway_id, admission)
       values ('player', '#2PP0V9UU', $1, 'h', $2, $3)`,
      [at, gw.gateway_id, admission],
    );

  const census = await snapshotDayCensus(SCRATCH_URL);
  assert.equal(census.rows, 9);
  assert.equal(census.players, 4);
  assert.equal(census.players_moving, 3);
  assert.deepEqual(census.unkeyable_rows, {
    unkeyable: 2,
    stampable: 1,
    stampable_moving: 1,
    first_day: "2026-08-30",
    last_day: "2026-09-01",
  });
  const daily = census.by_kind.find((k) => k.snapshot_kind === "daily");
  assert.equal(daily.rows, 8);
  assert.equal(daily.unkeyable, 2);
  assert.equal(
    daily.moving,
    3,
    "#2PP0V9PP 09-10, #2PP0V9QQ 09-10, #2PP0V9RR 09-12",
  );
  assert.equal(daily.staying, 3);
  assert.equal(
    daily.collisions,
    2,
    "#2PP0V9PP onto 09-09, #2PP0V9RR onto 09-11",
  );
  assert.equal(daily.dropped, 2);
  const pre = census.by_kind.find((k) => k.snapshot_kind === "pre_reset");
  assert.equal(pre.moving, 1);
  assert.equal(pre.collisions, 0);
  assert.deepEqual(
    census.moving_by_utc_hour.map((h) => [h.utc_hour, h.n]),
    [
      [3, 2],
      [8, 1],
      [9, 1],
    ],
  );

  // The op, two players a batch, driven to done.
  const runs = [];
  let after = "";
  for (;;) {
    const r = await snapshotRekey(SCRATCH_URL, { after, batch: 2 });
    runs.push(r);
    if (r.done) break;
    after = r.after;
  }
  assert.equal(
    runs.length,
    3,
    "two full batches, then the empty one that says done",
  );
  assert.deepEqual(runs[2], {
    players: 0,
    done: true,
    after: runs[1].after,
    ms: runs[2].ms,
  });
  assert.deepEqual(
    runs
      .slice(0, 2)
      .map((r) => [
        r.players,
        r.stamped_from_receipts,
        r.moved,
        r.inserted,
        r.replaced_older_row,
        r.dropped,
      ]),
    [
      [2, 0, 3, 2, 1, 0], // #2PP0V9PP's mover replaces the 09-09 row; #2PP0V9QQ's two inserted
      [2, 1, 2, 1, 1, 0], // #2PP0V9RR's mover replaces the 09-11 row; #2PP0V9UU stamped, moved
    ],
  );

  const { rows } = await db.query(
    `select player_tag, snapshot_date::text as day, snapshot_kind, trophies,
            observed_at
     from player_snapshot_daily order by player_tag, snapshot_date, snapshot_kind`,
  );
  assert.deepEqual(
    rows.map((r) => [r.player_tag, r.day, r.snapshot_kind, r.trophies]),
    [
      ["#2PP0V9PP", "2026-09-09", "daily", 5010],
      ["#2PP0V9PP", "2026-09-11", "daily", 5020],
      ["#2PP0V9QQ", "2026-09-09", "daily", 6000],
      ["#2PP0V9QQ", "2026-09-09", "pre_reset", 6001],
      ["#2PP0V9RR", "2026-09-11", "daily", 7000],
      ["#2PP0V9UU", "2026-08-30", "daily", 7990],
      ["#2PP0V9UU", "2026-08-31", "daily", 8000],
    ],
  );
  const stampedRow = rows.find((r) => r.trophies === 8000);
  assert.equal(
    stampedRow.observed_at.toISOString(),
    "2026-09-01T08:00:00.000Z",
    "the last ADMITTED receipt of the UTC day, not the rejected one",
  );
  // Every keyed row now sits on its game day; a second pass is a no-op.
  const again = await snapshotDayCensus(SCRATCH_URL);
  assert.equal(again.players_moving, 0);
  assert.equal(again.unkeyable_rows.unkeyable, 1);
  assert.equal(again.unkeyable_rows.stampable, 0);
  const idle = await snapshotRekey(SCRATCH_URL, { batch: 500 });
  assert.equal(idle.moved, 0);
  assert.equal(idle.done, true);
});
