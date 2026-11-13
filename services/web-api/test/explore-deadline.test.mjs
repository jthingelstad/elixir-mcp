/**
 * A tool behind a lock answers query_timeout on Explore (the app's tool
 * bridge behind Find and the player page's Record tab) before the
 * handler's 504. The invoker's deadline used to reach no web door: a
 * read waiting on a lock ran on until the handler gave up with a bare
 * 504 and no request id, and the query ran on after it. /api/v1 shared
 * this test until its tool mirrors went in JSON API 5.0.0.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { createSession } from "@elixir-mcp/auth";
import { makeHandler } from "../src/handler.mjs";

const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_explore_deadline_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);
let db, handler, cookie;

before(async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();
  await migrate({
    databaseUrl,
    migrationsDir: new URL("../../../db/migrations", import.meta.url).pathname,
  });
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const person = (
    await db.query(
      "insert into account(email_hash,status,role) values ('explore-deadline','approved','member') returning account_id",
    )
  ).rows[0].account_id;
  const session = await createSession(db, {
    secret: "test",
    accountId: person,
    emailHash: "explore-deadline",
  });
  cookie = `__Host-elixir_session=${session.token}`;
  handler = makeHandler({ databaseUrl, secret: "test" });
});
after(async () => {
  await db?.end();
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database ${name} with (force)`);
  await admin.end();
});

test("a tool behind a lock answers query_timeout on Explore before the handler's 504", async () => {
  // Soft deadline 2.5 s; the tool's is 1.5 s inside it.
  const context = { remainingMs: () => 4000 };
  const holder = new pg.Client({ connectionString: databaseUrl });
  await holder.connect();
  try {
    await holder.query("begin");
    await holder.query("lock table player in access exclusive mode");
    const explore = await handler(
      {
        path: "/api/explore",
        method: "POST",
        headers: { cookie, "x-elixir-client": "web" },
        body: JSON.stringify({
          tool: "players_names",
          args: { player_tags: ["#0CR"] },
        }),
      },
      context,
    );
    assert.equal(explore.statusCode, 200, explore.body);
    const body = JSON.parse(explore.body).body;
    assert.equal(body.error.code, "query_timeout");
    assert.ok(body.meta.request_id);
  } finally {
    await holder.query("rollback").catch(() => {});
    await holder.end();
  }
});
