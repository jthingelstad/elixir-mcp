import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDatabase } from "../src/database.mjs";
const connectionString =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";

test("concurrent requests hold separate clients; a returned lease releases transaction, settings and advisory locks", async () => {
  const database = makeDatabase({ connectionString, max: 2 });
  const a = database.lease(),
    b = database.lease();
  await a.connect();
  await b.connect();
  try {
    const pidA = (await a.query("select pg_backend_pid() as pid")).rows[0].pid;
    assert.notEqual(
      pidA,
      (await b.query("select pg_backend_pid() as pid")).rows[0].pid,
    );
    await a.query("begin");
    await a.query("set work_mem = '32MB'");
    await a.query("select pg_advisory_lock(987654321)");
    assert.equal(
      (await b.query("select pg_try_advisory_lock(987654321) as got")).rows[0]
        .got,
      false,
    );
    await a.end();
    const next = database.lease();
    await next.connect();
    try {
      assert.equal(
        (await next.query("select pg_backend_pid() as pid")).rows[0].pid,
        pidA,
      );
      assert.notEqual(
        (await next.query("show work_mem")).rows[0].work_mem,
        "32MB",
      );
      assert.equal(
        (await b.query("select pg_try_advisory_lock(987654321) as got")).rows[0]
          .got,
        true,
      );
      await next.query("select 1");
    } finally {
      await next.end();
    }
  } finally {
    await a.end();
    await b.end();
    await database.close();
  }
});

test("an abandoned query destroys its client and cannot issue work on the next request's connection", async () => {
  const database = makeDatabase({ connectionString, max: 1 });
  const abandoned = database.lease();
  await abandoned.connect();
  const oldPid = (await abandoned.query("select pg_backend_pid() as pid"))
    .rows[0].pid;
  const pending = abandoned.query("select pg_sleep(5)").catch(() => null);
  await abandoned.end();
  const next = database.lease();
  await next.connect();
  try {
    assert.notEqual(
      (await next.query("select pg_backend_pid() as pid")).rows[0].pid,
      oldPid,
    );
    await assert.rejects(abandoned.query("select 1"), /not open/);
    await pending;
  } finally {
    await next.end();
    await database.close();
  }
});

test("a lease that expires in the pool queue never acquires another request's client", async () => {
  const database = makeDatabase({ connectionString, max: 1 });
  const active = database.lease();
  await active.connect();
  const queued = database.lease();
  const acquisition = queued.connect();
  await queued.end();
  await active.end();
  await assert.rejects(acquisition, /expired while waiting/);
  const next = database.lease();
  await next.connect();
  await next.end();
  await database.close();
});
