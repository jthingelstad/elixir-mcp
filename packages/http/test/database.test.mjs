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

test("a connection that never opened is tried once more; a full pool or a second failure is not retried", async () => {
  const fakePool = (failures) => {
    let calls = 0;
    return {
      get calls() {
        return calls;
      },
      on() {},
      end: async () => {},
      async connect() {
        calls += 1;
        const f = failures.shift();
        if (f) throw f;
        return { release() {}, query: async () => ({ rows: [] }) };
      },
    };
  };
  const opened = () =>
    new Error("Connection terminated due to connection timeout");
  const errors = [];
  const error = console.error;
  console.error = (e) => errors.push(e);
  try {
    // Cold start: the first connection outlives the timeout, the second opens.
    let pool = fakePool([opened()]);
    let lease = makeDatabase({ connectionString, pool }).lease();
    await lease.connect();
    assert.equal(pool.calls, 2);
    await lease.end();
    assert.deepEqual(errors, [{ event: "db_connect_retry", name: "Error" }]);
    // Twice failed: the second error is the answer; never a third try.
    pool = fakePool([opened(), opened()]);
    lease = makeDatabase({ connectionString, pool }).lease();
    await assert.rejects(lease.connect(), /connection timeout/);
    assert.equal(pool.calls, 2);
    // A full pool waits no longer than its timeout.
    pool = fakePool([new Error("timeout exceeded when trying to connect")]);
    lease = makeDatabase({ connectionString, pool }).lease();
    await assert.rejects(lease.connect(), /timeout exceeded/);
    assert.equal(pool.calls, 1);
    // A refused socket is a connection that never opened.
    pool = fakePool([
      Object.assign(new Error("refused"), { code: "ECONNREFUSED" }),
    ]);
    lease = makeDatabase({ connectionString, pool }).lease();
    await lease.connect();
    assert.equal(pool.calls, 2);
  } finally {
    console.error = error;
  }
});
