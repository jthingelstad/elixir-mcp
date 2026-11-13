import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { makeInvoker } from "../../../packages/tools/src/invoker.mjs";
import { makeRegistry } from "../../../packages/tools/src/tools.mjs";
import { makeHandler } from "../src/handler.mjs";
import { createHash } from "node:crypto";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_query_budget_${process.pid}`;
let db;
let account;

/** The connection, with the server's own answer to each pg_sleep kept:
 *  "completed", or the SQLSTATE that ended it. 57014 means PostgreSQL
 *  cancelled the statement (its statement_timeout fired); a promise the
 *  invoker merely abandoned would complete after the full sleep. No
 *  stopwatch: a loaded host moves wall time, never the SQLSTATE
 *  (2026-11-13, a 5 s bound missed under several concurrent verifies). */
function watched(pattern = /pg_sleep/) {
  const sleeps = [];
  return {
    sleeps,
    query(sql, params) {
      const p = db.query(sql, params);
      if (pattern.test(String(sql)))
        sleeps.push(
          p.then(
            () => "completed",
            (err) => err.code,
          ),
        );
      return p;
    },
  };
}

before(async () => {
  await createScratch(name);
  const url = adminUrl.replace(/\/postgres$/, `/${name}`);
  db = new pg.Client({ connectionString: url });
  await db.connect();
  const { rows } = await db.query(
    "insert into account (email_hash, status) values ('query-budget', 'approved') returning account_id",
  );
  account = { accountId: rows[0].account_id };
});

after(async () => {
  await db?.end();
  await dropScratch(name);
});

test("slow aggregation is canceled, answered with a reportable timeout, and audited", async () => {
  const conn = watched();
  const invoke = makeInvoker({
    db: conn,
    account,
    queryBudgetMs: 150,
    registry: {
      invoke: async (_name, ctx) => {
        await ctx.db.query("select pg_sleep(10)");
        return { ok: true };
      },
    },
  });
  const result = await invoke("war_history", {
    clan_tag: "#J2RGCRVG",
    limit: 5,
  });
  assert.equal(result.isError, true);
  assert.equal(result.body.error.code, "query_timeout");
  assert.equal(result.body.error.class, "retry");
  assert.match(result.body.error.hint, /war_history\(/);
  assert.deepEqual(
    await Promise.all(conn.sleeps),
    ["57014"],
    "the server cancels the query rather than merely abandoning its promise",
  );
  const { rows } = await db.query(
    "select request_id, error_code from mcp_call_audit order by created_at desc limit 1",
  );
  assert.equal(rows[0].error_code, "query_timeout");
  assert.equal(rows[0].request_id, result.body.meta.request_id);
  assert.equal(
    (await db.query("show statement_timeout")).rows[0].statement_timeout,
    "0",
  );
  assert.equal((await db.query("select 1 as n")).rows[0].n, 1);
});

test("the budget covers the whole aggregation, not one independent allowance per query", async () => {
  const invoke = makeInvoker({
    db,
    account,
    queryBudgetMs: 300,
    registry: {
      invoke: async (_name, ctx) => {
        await ctx.db.query("select pg_sleep(0.18)");
        await ctx.db.query("select pg_sleep(0.18)");
        return { ok: true };
      },
    },
  });
  const result = await invoke("war_history", { clan_tag: "#J2RGCRVG" });
  assert.equal(result.body.error.code, "query_timeout");
});

test("successful aggregation restores the connection timeout", async () => {
  const invoke = makeInvoker({
    db,
    account,
    queryBudgetMs: 1000,
    registry: {
      invoke: async (_name, ctx) =>
        (await ctx.db.query("select 1 as n")).rows[0],
    },
  });
  assert.equal((await invoke("clans_standings", {})).isError, false);
  assert.equal(
    (await db.query("show statement_timeout")).rows[0].statement_timeout,
    "0",
  );
});

test("a restore cancelled by the call's own leftover timeout is tried again, so the next caller never inherits it", async () => {
  // Verify, 2026-11-12: under load the restore's set_config outlasted the
  // last per-query timeout, was cancelled, and the next caller on the
  // connection ran with a 1 ms statement_timeout.
  const attempts = [];
  const flaky = {
    query: async (sql, params) => {
      if (
        String(sql).startsWith("select set_config($1, $2") &&
        params?.[0] === "statement_timeout"
      ) {
        attempts.push(params[1]);
        if (attempts.length === 1) {
          const err = new Error("canceling statement due to statement timeout");
          err.code = "57014";
          throw err;
        }
      }
      return db.query(sql, params);
    },
  };
  const invoke = makeInvoker({
    db: flaky,
    account,
    queryBudgetMs: 1000,
    registry: {
      invoke: async (_name, ctx) =>
        (await ctx.db.query("select 1 as n")).rows[0],
    },
  });
  assert.equal((await invoke("clans_standings", {})).isError, false);
  assert.deepEqual(attempts, ["0", "0"]);
  assert.equal(
    (await db.query("show statement_timeout")).rows[0].statement_timeout,
    "0",
  );
});

test("the analytical budget never interrupts an account mutation", async () => {
  const statements = [];
  const fake = {
    query: async (sql) => {
      statements.push(sql);
      return { rows: [] };
    },
  };
  const invoke = makeInvoker({
    db: fake,
    account,
    queryBudgetMs: 1,
    registry: {
      invoke: async (_name, ctx) => {
        await ctx.db.query("account write");
        return { ok: true };
      },
    },
  });
  assert.equal((await invoke("elixir_nickname", {})).isError, false);
  assert.ok(statements.every((sql) => !sql.includes("statement_timeout")));
});

test("the Lambda deadline answers a slow read tool with query_timeout and audits it as timeout", async () => {
  const conn = watched();
  const invoke = makeInvoker({
    db: conn,
    account,
    deadlineMs: 150,
    registry: {
      invoke: async (_name, ctx) => {
        await ctx.db.query("select pg_sleep(10)");
        return { ok: true };
      },
    },
  });
  // Not an analytical tool: before 3.14.0 nothing cancelled it and the
  // client saw a bare HTTP 500.
  const result = await invoke("war_current", {});
  assert.equal(result.isError, true);
  assert.equal(result.body.error.code, "query_timeout");
  assert.ok(result.body.meta.request_id);
  // As above: the server's SQLSTATE, not a stopwatch.
  assert.deepEqual(
    await Promise.all(conn.sleeps),
    ["57014"],
    "cancelled in PostgreSQL, not abandoned",
  );
  const { rows } = await db.query(
    "select request_id, error_code from mcp_call_audit order by created_at desc limit 1",
  );
  assert.equal(rows[0].error_code, "timeout");
  assert.equal(rows[0].request_id, result.body.meta.request_id);
  assert.equal(
    (await db.query("show statement_timeout")).rows[0].statement_timeout,
    "0",
  );
  assert.equal((await db.query("select 1 as n")).rows[0].n, 1);
});

test("a query whose timeout was still being set when the deadline fired is never sent", async () => {
  // A loaded run, 2026-11-13: the per-query statement_timeout answered
  // after the deadline, the restore had already put 0 back, and the
  // abandoned pg_sleep(10) then ran unbounded and held the connection,
  // so the audit insert behind it waited ten seconds. Here the set's
  // reply is held until the call has answered: no clock involved.
  let answered;
  const callAnswered = new Promise((resolve) => (answered = resolve));
  const sent = [];
  const held = {
    query: async (sql, params) => {
      sent.push(String(sql));
      const result = await db.query(sql, params);
      if (String(sql).startsWith("select set_config('statement_timeout'"))
        await callAnswered;
      return result;
    },
  };
  let toolRun;
  const invoke = makeInvoker({
    db: held,
    account,
    deadlineMs: 150,
    registry: {
      invoke: (_name, ctx) =>
        (toolRun = (async () => {
          await ctx.db.query("select pg_sleep(10)");
          return { ok: true };
        })()),
    },
  });
  const result = await invoke("war_current", {});
  assert.equal(result.body.error.code, "query_timeout");
  answered();
  await assert.rejects(toolRun, (err) => err.code === "query_timeout");
  assert.ok(!sent.some((sql) => sql.includes("pg_sleep")));
  assert.equal(
    (await db.query("show statement_timeout")).rows[0].statement_timeout,
    "0",
  );
});

test("the deadline covers work outside the database, such as a live-lane wait", async () => {
  // The wait outside the database ends only when the test says so, after
  // the answer: an answer at all proves the deadline, with no clock.
  let release;
  const waiting = new Promise((resolve) => (release = resolve));
  const invoke = makeInvoker({
    db,
    account,
    deadlineMs: 100,
    registry: {
      invoke: async () => {
        await waiting;
        return { ok: true };
      },
    },
  });
  const result = await invoke("clans_roster", { live: true });
  release();
  assert.equal(result.body.error.code, "query_timeout");
  const { rows } = await db.query(
    "select error_code from mcp_call_audit order by created_at desc limit 1",
  );
  assert.equal(rows[0].error_code, "timeout");
});

test("the deadline never races an account write", async () => {
  const invoke = makeInvoker({
    db,
    account,
    deadlineMs: 50,
    registry: {
      invoke: async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return { ok: true };
      },
    },
  });
  const result = await invoke("elixir_nickname", {});
  assert.equal(result.isError, false);
});

test("an analytical tool under both guards audits the one that fired", async () => {
  const invoke = makeInvoker({
    db,
    account,
    queryBudgetMs: 5000,
    deadlineMs: 120,
    registry: {
      invoke: async (_name, ctx) => {
        await ctx.db.query("select pg_sleep(1)");
        return { ok: true };
      },
    },
  });
  const result = await invoke("war_history", {
    season_id: 1,
    section_index: 0,
  });
  assert.equal(result.body.error.code, "query_timeout");
  const { rows } = await db.query(
    "select error_code from mcp_call_audit order by created_at desc limit 1",
  );
  assert.equal(rows[0].error_code, "timeout");
});

test("a connection-wide ceiling from PGOPTIONS stays a ceiling: the per-call budget overrides it, and it comes back", async () => {
  // Production sets PGAPPNAME and PGOPTIONS per function (review
  // 2026-09-27 §3.1); node-pg reads both at connect. The invoker's
  // set_config must still win for the call, above the default as well as
  // below it, and the default must be what is left afterwards.
  const url = adminUrl.replace(/\/postgres$/, `/${name}`);
  const saved = [process.env.PGAPPNAME, process.env.PGOPTIONS];
  process.env.PGAPPNAME = "elixir-mcp-test";
  process.env.PGOPTIONS =
    "-c statement_timeout=1s -c idle_in_transaction_session_timeout=60s";
  const bounded = new pg.Client({ connectionString: url });
  try {
    await bounded.connect();
  } finally {
    [process.env.PGAPPNAME, process.env.PGOPTIONS] = saved;
    if (saved[0] === undefined) delete process.env.PGAPPNAME;
    if (saved[1] === undefined) delete process.env.PGOPTIONS;
  }
  try {
    const setting = async (key) =>
      (await bounded.query(`select current_setting('${key}') as v`)).rows[0].v;
    assert.equal(await setting("application_name"), "elixir-mcp-test");
    assert.equal(await setting("statement_timeout"), "1s");
    assert.equal(await setting("idle_in_transaction_session_timeout"), "1min");
    // Above the default: a 1.2 s read inside a 5 s budget completes.
    const slow = await makeInvoker({
      db: bounded,
      account,
      queryBudgetMs: 5000,
      registry: {
        invoke: async (_name, ctx) => {
          await ctx.db.query("select pg_sleep(1.2)");
          return { ok: true };
        },
      },
    })("clans_standings", {});
    assert.equal(slow.isError, false, JSON.stringify(slow.body));
    assert.equal(await setting("statement_timeout"), "1s");
    // Below it: the budget cancels first. The code proves it: a 0.8 s sleep is
    // inside the 1 s ceiling, so nothing else could cut it. No wall clock here;
    // a stopwatch failed under the concurrent test runner.
    const cut = await makeInvoker({
      db: bounded,
      account,
      queryBudgetMs: 150,
      registry: {
        invoke: async (_name, ctx) => {
          await ctx.db.query("select pg_sleep(0.8)");
          return { ok: true };
        },
      },
    })("clans_standings", {});
    assert.equal(cut.body.error.code, "query_timeout");
    assert.equal(await setting("statement_timeout"), "1s");
    // Outside a tool the ceiling holds.
    await assert.rejects(bounded.query("select pg_sleep(1.5)"), {
      code: "57014",
    });
  } finally {
    await bounded.end();
  }
});

test("a deadline that passes while the budget is still being set leaves the connection as it found it", async () => {
  // Found under load (2026-10-21, the concurrent test runner): when the
  // deadline fired before the budget's first read of the connection's
  // settings had returned, the restore found nothing to restore, and the
  // abandoned tool then set statement_timeout to its remaining budget on
  // a connection the caller had already been answered on. A slow first
  // read makes that order certain here.
  const settings = async () =>
    (
      await db.query(
        "select current_setting('statement_timeout') as statement_timeout, current_setting('lock_timeout') as lock_timeout, current_setting('work_mem') as work_mem",
      )
    ).rows[0];
  const before = await settings();
  let settled;
  const done = new Promise((r) => (settled = r));
  const slowFirstRead = new Proxy(db, {
    get(target, prop) {
      if (prop !== "query") {
        const v = target[prop];
        return typeof v === "function" ? v.bind(target) : v;
      }
      return async (sql, ...rest) => {
        if (String(sql).includes("current_setting('statement_timeout')"))
          await new Promise((r) => setTimeout(r, 300));
        return target.query(sql, ...rest);
      };
    },
  });
  const result = await makeInvoker({
    db: slowFirstRead,
    account,
    queryBudgetMs: 100,
    registry: {
      invoke: async (_name, ctx) => {
        try {
          await ctx.db.query("select pg_sleep(0.5)");
          return { ok: true };
        } finally {
          settled();
        }
      },
    },
  })("clans_standings", {});
  assert.equal(result.body.error.code, "query_timeout");
  await done;
  // The abandoned read was cancelled at the server, and nothing it set
  // outlives the call.
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(await settings(), before);
});

test("a read-only tool behind a lock gives up at the lock timeout, answers query_timeout, and restores the setting", async () => {
  // The 2026-09-15 shape: an orphaned backend holds ACCESS EXCLUSIVE and
  // every read queues behind it, each holding a connection.
  await db.query("create table if not exists budget_locked (n int)");
  const url = adminUrl.replace(/\/postgres$/, `/${name}`);
  const holder = new pg.Client({ connectionString: url });
  await holder.connect();
  try {
    await holder.query("begin");
    await holder.query("lock table budget_locked in access exclusive mode");
    const conn = watched(/from budget_locked/);
    const result = await makeInvoker({
      db: conn,
      account,
      deadlineMs: 10_000,
      lockTimeoutMs: 200,
      registry: {
        invoke: async (_name, ctx) =>
          (await ctx.db.query("select count(*) from budget_locked")).rows[0],
      },
    })("war_current", {});
    assert.equal(result.isError, true);
    assert.equal(result.body.error.code, "query_timeout");
    // 55P03 is lock_timeout's own SQLSTATE; the deadline's
    // statement_timeout would end it with 57014.
    assert.deepEqual(
      await Promise.all(conn.sleeps),
      ["55P03"],
      "the lock wait ended at the lock timeout, not the deadline",
    );
    assert.equal(
      (await db.query("show lock_timeout")).rows[0].lock_timeout,
      "0",
    );
    // A write is never on this path: it waits for the lock as before.
    const statements = [];
    const fake = {
      query: async (sql) => {
        statements.push(String(sql));
        return { rows: [] };
      },
    };
    await makeInvoker({
      db: fake,
      account,
      deadlineMs: 10_000,
      registry: {
        invoke: async (_name, ctx) => {
          await ctx.db.query("account write");
          return { ok: true };
        },
      },
    })("elixir_nickname", {});
    assert.ok(statements.every((sql) => !sql.includes("lock_timeout")));
  } finally {
    await holder.query("rollback").catch(() => {});
    await holder.end();
  }
});

test("the real MCP handler shortens the budget to leave Lambda reply time", async () => {
  const key = "svt_query_budget_fixture";
  await db.query(
    "insert into service_token (account_id, name, token_hash) values ($1, 'query-budget-test', $2)",
    [account.accountId, createHash("sha256").update(key).digest("hex")],
  );
  const handler = makeHandler({
    databaseUrl: adminUrl.replace(/\/postgres$/, `/${name}`),
  });
  const res = await handler(
    {
      path: "/mcp",
      method: "POST",
      headers: { authorization: `Bearer ${key}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "clans_standings",
          arguments: { clan_tag: "#J2RGCRVG" },
        },
      }),
    },
    { remainingMs: () => 6500 },
  );
  assert.equal(res.statusCode, 200);
  const result = JSON.parse(res.body).result;
  assert.equal(result.isError, true);
  // An error rides the text block alone: structuredContent is held to
  // the tool's outputSchema, which a refusal does not meet (#65).
  assert.equal(result.structuredContent, undefined);
  const refusal = JSON.parse(result.content[0].text);
  assert.equal(refusal.error.code, "query_timeout");
  assert.ok(refusal.meta.request_id);
});

test("an unrecorded rival roster names the exact live retry without changing recording", async () => {
  const result = await makeInvoker({ db, account, registry: makeRegistry() })(
    "clans_roster",
    { clan_tag: "#08L2PR0V", verbosity: "compact" },
  );
  assert.equal(result.body.error.code, "not_recorded");
  assert.match(
    result.body.error.hint,
    /clans_roster\(\{"clan_tag":"#08L2PR0V","verbosity":"compact","live":true\}\)/,
  );
  assert.equal(
    (await db.query("select count(*)::int as n from recording")).rows[0].n,
    0,
  );
});
