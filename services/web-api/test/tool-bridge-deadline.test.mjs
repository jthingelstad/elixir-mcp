/**
 * A tool behind a lock answers query_timeout on the app's tool bridge
 * (behind Find and the player page's Record tab) before the
 * handler's 504. The invoker's deadline used to reach no web door: a
 * read waiting on a lock ran on until the handler gave up with a bare
 * 504 and no request id, and the query ran on after it. /api/v1 shared
 * this test until its tool mirrors went in JSON API 5.0.0.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createSession } from "@elixir-mcp/auth";
import { makeHandler } from "../src/handler.mjs";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_tool_bridge_deadline_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);
let db, handler, cookie;

before(async () => {
  await createScratch(name);
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const person = (
    await db.query(
      "insert into account(email_hash,status,role) values ('tool-bridge-deadline','approved','member') returning account_id",
    )
  ).rows[0].account_id;
  const session = await createSession(db, {
    secret: "test",
    accountId: person,
    emailHash: "tool-bridge-deadline",
  });
  cookie = `__Host-elixir_session=${session.token}`;
  handler = makeHandler({ databaseUrl, secret: "test" });
});
after(async () => {
  await db?.end();
  await dropScratch(name);
});

test("a tool behind a lock answers query_timeout on the app's tool bridge before the handler's 504", async () => {
  // Soft deadline 2.5 s; the tool's is 1.5 s inside it.
  const context = { remainingMs: () => 4000 };
  const holder = new pg.Client({ connectionString: databaseUrl });
  await holder.connect();
  try {
    await holder.query("begin");
    await holder.query("lock table player in access exclusive mode");
    const res = await handler(
      {
        path: "/api/me/tool",
        method: "POST",
        headers: { cookie, "x-elixir-client": "web" },
        body: JSON.stringify({
          tool: "players_summary",
          args: { player_tag: "#20JJJ2CCRU" },
        }),
      },
      context,
    );
    assert.equal(res.statusCode, 200, res.body);
    const body = JSON.parse(res.body).body;
    assert.equal(body.error.code, "query_timeout");
    assert.ok(body.meta.request_id);
  } finally {
    await holder.query("rollback").catch(() => {});
    await holder.end();
  }
});
