/**
 * vacuumWhole (helpers.mjs), the seed step the plan and buffer tests
 * stand on (2026-11-17): a snapshot another backend took before the
 * rows were written keeps a bare VACUUM from marking them, which is what
 * left the budget seeds' maps short under load; vacuumWhole waits it out
 * and confirms the map. The other backend here is a client of the test's
 * own, so the order is fixed, not raced.
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

test("a snapshot older than the rows keeps a bare vacuum from the map, and vacuumWhole waits it out", async () => {
  const { db, url } = ctx;
  const holder = new pg.Client({ connectionString: url });
  await holder.connect();
  try {
    await holder.query("begin isolation level repeatable read");
    await holder.query("select 1"); // the snapshot, taken now
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
    const whole = vacuumWhole(db, ["vw_probe"]).then(() => (done = true));
    assert.equal((await snapshotHolders(db)).length, 1);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(done, false, "it does not vacuum under the snapshot");
    // ... and once it is let go, the map is whole.
    await holder.query("commit");
    await whole;
    assert.deepEqual(await shortMaps(db, ["vw_probe"]), []);
  } finally {
    await holder.end();
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
