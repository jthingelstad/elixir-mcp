import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import os from "node:os";
import { readFileSync } from "node:fs";
import { retainedDayAudit } from "../src/ops-retained-day.mjs";

const adminUrl =
  process.env.PG_ADMIN_URL ??
  `postgres://${os.userInfo().username}@localhost:5432/postgres`;
const name = `elixir_mcp_test_retained_day_${process.pid}`;
const url = adminUrl.replace(/\/postgres$/, `/${name}`);
const id = (n) => n.toString(16).padStart(64, "0");
let db;
before(async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();
  db = new pg.Client({ connectionString: url });
  await db.connect();
  await db.query(`create table battle (battle_id text primary key, battle_time timestamptz not null, created_at timestamptz not null);
    create table battle_participant (battle_id text not null references battle, player_tag text not null, primary key(battle_id,player_tag));
    create index battle_time_idx on battle(battle_time)`);
  for (const [n, played, created] of [
    [1, "2026-09-12T23:59:59.999999Z", "2026-09-13T00:00:00Z"],
    [2, "2026-09-13T00:00:00Z", "2026-09-13T00:01:00.123456Z"],
    [3, "2026-09-13T12:00:00Z", "2026-10-04T01:00:00Z"],
    [4, "2026-09-13T23:59:59.999999Z", "2026-09-14T00:01:00Z"],
    [5, "2026-09-14T00:00:00Z", "2026-09-14T00:01:00Z"],
  ]) {
    await db.query("insert into battle values ($1,$2,$3)", [
      id(n),
      played,
      created,
    ]);
    for (const tag of ["#P2", "#P1", ...(n === 3 ? ["#P4", "#P3"] : [])])
      await db.query("insert into battle_participant values ($1,$2)", [
        id(n),
        tag,
      ]);
  }
});
after(async () => {
  await db?.end();
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.end();
});

test("keyset pages include exactly the fixed UTC day, every participant, and precise creation timestamps", async () => {
  const first = await retainedDayAudit(url, { day: "2026-09-13", limit: 2 });
  assert.equal(first.readonly, true);
  assert.equal(first.snapshot_isolation, "repeatable_read_per_page");
  assert.deepEqual(
    first.rows.map((row) => row.battle_id),
    [id(2), id(3)],
  );
  assert.equal(first.rows[0].created_at, "2026-09-13T00:01:00.123456Z");
  assert.equal(first.rows[1].created_at, "2026-10-04T01:00:00.000000Z");
  assert.deepEqual(first.rows[1].player_tags, ["#P1", "#P2", "#P3", "#P4"]);
  assert.deepEqual(Object.keys(first.rows[0]).sort(), [
    "battle_id",
    "battle_time",
    "created_at",
    "player_tags",
  ]);
  assert.equal(first.next_after, id(3));
  assert.equal(first.done, false);
  const second = await retainedDayAudit(url, {
    day: "2026-09-13",
    limit: 2,
    after: first.next_after,
  });
  assert.deepEqual(
    second.rows.map((row) => row.battle_id),
    [id(4)],
  );
  assert.equal(second.rows[0].battle_time, "2026-09-13T23:59:59.999999Z");
  assert.equal(second.next_after, null);
  assert.equal(second.done, true);
  const repeat = await retainedDayAudit(url, { day: "2026-09-13", limit: 2 });
  assert.deepEqual(repeat, first);
  const empty = await retainedDayAudit(url, {
    day: "2026-09-13",
    after: id(9),
  });
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.done, true);
  assert.equal(
    (await db.query("select count(*)::int as n from battle")).rows[0].n,
    5,
  );
});

for (const spec of [
  undefined,
  true,
  [],
  {},
  { day: "2026-09-14" },
  { day: "2026-09-13", sql: "select 1" },
  { day: "2026-09-13", apply: true },
  { day: "2026-09-13", live: false },
  { day: "2026-09-13", after: "' OR TRUE --" },
  { day: "2026-09-13", after: 1 },
  ...[0, 501, 1.5, "500"].map((limit) => ({ day: "2026-09-13", limit })),
]) {
  test(`invalid or broadened input refuses before any connection: ${JSON.stringify(spec)}`, async () => {
    const client = {
      connect: () => {
        throw new Error("must not connect");
      },
    };
    const result = await retainedDayAudit("unused", spec, client);
    assert.equal(result.error, "invalid_retained_day_audit");
  });
}

test("query failure rolls back its read-only transaction and never exposes error text", async () => {
  const calls = [];
  let ended = false;
  const client = {
    async connect() {},
    async query(sql) {
      calls.push(sql);
      if (sql.includes("with page"))
        throw new Error("PRIVATE database host and secret");
      return { rows: [] };
    },
    async end() {
      ended = true;
    },
  };
  assert.deepEqual(
    await retainedDayAudit("unused", { day: "2026-09-13" }, client),
    { error: "retained_day_audit_failed" },
  );
  assert.equal(calls[0], "begin isolation level repeatable read read only");
  assert.ok(calls.includes("set local statement_timeout = '5s'"));
  assert.ok(calls.includes("set local lock_timeout = '500ms'"));
  assert.ok(
    calls.includes("set local idle_in_transaction_session_timeout = '10s'"),
  );
  assert.equal(calls.at(-1), "rollback");
  assert.equal(ended, true);
});

test("the private dispatcher logs counts without participant facts and adds no public route", () => {
  const source = readFileSync(
    new URL("../src/lambda.mjs", import.meta.url),
    "utf8",
  );
  const branch = source.slice(
    source.indexOf("if (event?.retained_day_audit)"),
    source.indexOf("if (event?.clan_context)"),
  );
  assert.match(branch, /rows: result.rows\?\.length/);
  assert.doesNotMatch(branch, /console\.log\(JSON\.stringify\(result\)\)/);
});

test("mixed and falsy audit dispatch never reaches another operation or connection", async () => {
  const { handler } = await import("../src/lambda.mjs");
  const connect = pg.Client.prototype.connect;
  let connections = 0;
  pg.Client.prototype.connect = async function () {
    connections++;
    throw new Error("forbidden connection");
  };
  try {
    for (const payload of [
      {
        retained_day_audit: { day: "2026-09-13" },
        vacuum: { table: "battle" },
      },
      {
        clan_maintenance: { lane: "respond", apply: true },
        retained_day_audit: { day: "2026-09-13" },
      },
      { retained_day_audit: false, account_track: { dry_run: false } },
      { retained_day_audit: null },
      { retained_day_audit: true },
    ])
      assert.equal(
        (await handler(payload)).error,
        "invalid_retained_day_audit",
      );
    assert.equal(connections, 0);
  } finally {
    pg.Client.prototype.connect = connect;
  }
});

test("oversized participant projection refuses without a partial successful page", async () => {
  const calls = [];
  const client = {
    async connect() {},
    async query(sql) {
      calls.push(sql);
      return {
        rows: sql.includes("with page")
          ? [
              {
                battle_id: id(2),
                player_tags: Array.from({ length: 9 }, (_, n) => `#P${n}`),
              },
            ]
          : [],
      };
    },
    async end() {},
  };
  const result = await retainedDayAudit(
    "unused",
    { day: "2026-09-13" },
    client,
  );
  assert.deepEqual(result, { error: "retained_day_audit_failed" });
  assert.equal(calls.at(-1), "rollback");
});

test("500-row page boundary emits only500 and resumes after its last emitted ID", async () => {
  await db.query(
    "insert into battle select lpad(to_hex(n),64,'0'),'2026-09-13T01:00:00Z'::timestamptz,'2026-09-13T01:00:01Z'::timestamptz from generate_series(10,510) n",
  );
  try {
    const first = await retainedDayAudit(url, {
      day: "2026-09-13",
      after: id(9),
      limit: 500,
    });
    assert.equal(first.rows.length, 500);
    assert.equal(first.next_after, id(509));
    assert.equal(first.done, false);
    const second = await retainedDayAudit(url, {
      day: "2026-09-13",
      after: first.next_after,
    });
    assert.deepEqual(
      second.rows.map((r) => r.battle_id),
      [id(510)],
    );
    assert.equal(second.done, true);
  } finally {
    await db.query("delete from battle where battle_id >= $1", [id(10)]);
  }
});
