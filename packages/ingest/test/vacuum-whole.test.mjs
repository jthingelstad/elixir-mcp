/**
 * vacuumWhole (helpers.mjs), the seed step the plan and buffer tests
 * stand on (2026-11-17): a snapshot another backend took before the
 * rows were written keeps a bare VACUUM from marking them, which is what
 * left the budget seeds' maps short under load; vacuumWhole waits it out
 * and confirms the map. Two backends here are clients of the test's
 * own, so their snapshots and release order are fixed, not raced. Other
 * real blockers, including the helper's concurrent read, may be present.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {
  scratchDb,
  shortMaps,
  snapshotHolders,
  vacuumWhole,
} from "./helpers.mjs";

let ctx;
before(async () => {
  ctx = await scratchDb("vacuum_whole");
});
after(async () => {
  await ctx?.drop();
});

test("snapshots older than the rows keep a bare vacuum from the map, and vacuumWhole waits for both", async () => {
  const { db, url } = ctx;
  const holders = [
    new pg.Client({ connectionString: url }),
    new pg.Client({ connectionString: url }),
  ];
  const connected = [];
  const holderPids = [];
  let whole;
  try {
    for (const holder of holders) {
      await holder.connect();
      connected.push(holder);
      await holder.query("begin isolation level repeatable read");
      const {
        rows: [{ pid }],
      } = await holder.query("select pg_backend_pid() as pid");
      holderPids.push(pid); // both snapshots precede the rows
    }
    await db.query(
      `create table vw_probe (id int primary key, v int) with (autovacuum_enabled = false)`,
    );
    await db.query(
      `insert into vw_probe select g, g from generate_series(1, 20000) g`,
    );

    // What the seeds did: one bare vacuum. Nothing is marked.
    await db.query("vacuum (analyze) vw_probe");
    const [bare] = await shortMaps(db, ["vw_probe"]);
    assert.ok(bare, "a bare vacuum under an older snapshot leaves it short");
    assert.equal(bare.relallvisible, 0);

    // vacuumWhole waits while the snapshot is held ...
    let done = false;
    whole = vacuumWhole(db, ["vw_probe"]).then(() => (done = true));
    // Mark a background failure handled immediately; the explicit await below
    // still fails this test, and finally always drains it before the pool drops.
    whole.catch(() => {});
    const snapshots = await snapshotHolders(db);
    for (const pid of holderPids)
      assert.ok(
        snapshots.some((snapshot) => snapshot.pid === pid),
        `the known snapshot holder ${pid} is reported`,
      );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(done, false, "it does not vacuum under the snapshot");
    // ... and once it is let go, the map is whole.
    await holders[0].query("commit");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(done, false, "it still waits for the other held snapshot");
    await holders[1].query("commit");
    await whole;
    assert.deepEqual(await shortMaps(db, ["vw_probe"]), []);
  } finally {
    // Release snapshots first, then settle the helper while its pool is still
    // open. An assertion failure must leave no background query after teardown.
    for (const holder of connected)
      await holder.query("rollback").catch(() => {});
    await whole?.catch(() => {});
    for (const holder of connected) await holder.end();
  }
});

test("a snapshot never let go fails it, naming who holds it", async () => {
  const { db, url } = ctx;
  await db.query(
    `create table vw_held (id int primary key) with (autovacuum_enabled = false)`,
  );
  const holder = new pg.Client({ connectionString: url });
  await holder.connect();
  try {
    await holder.query("begin isolation level repeatable read");
    await holder.query("select 1");
    await db.query(`insert into vw_held select generate_series(1, 20000)`);
    // The holder ends only after vacuumWhole has given up; a zero wait
    // gives up at the first look.
    await assert.rejects(
      vacuumWhole(db, ["vw_held"], { attempts: 2, quietMs: 0 }),
      /snapshots still held/,
    );
  } finally {
    await holder.query("commit").catch(() => {});
    await holder.end();
  }
});
