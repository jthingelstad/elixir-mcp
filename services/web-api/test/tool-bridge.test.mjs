/**
 * The app's tool bridge answers the app's own tools and nothing else
 * (2026-11-14). It used to open every read-only tool to the browser, a
 * leftover of the Console's Explore page; now a read-only tool the app
 * does not call is refused before it runs, as an unknown one is, and
 * spends nothing of the hourly bucket. POST /api/explore, the old path,
 * answers with the same handler until a later pull request removes it.
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
const name = `elixir_mcp_test_tool_bridge_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);
let db, handler, cookie, accountId;

const ROUTE = "/api/me/tool";
// Remove with the alias (tool-bridge.mjs).
const OLD_ROUTE = "/api/explore";
const PATHS = [ROUTE, OLD_ROUTE];

/** Each tool the app calls, with the arguments it sends. */
const APP_TOOLS = [
  ["players_summary", { player_tag: "#20JJJ2CCRU" }],
  ["players_profile", { player_tag: "#20JJJ2CCRU" }],
  ["players_search", { query: "King", limit: 8 }],
  ["clans_roster", { clan_tag: "#J2RGCRVG" }],
  ["elixir_nickname", { player_tag: "#20JJJ2CCRU", nickname: "King" }],
];

/** Read-only tools the app no longer calls through the bridge. */
const NOT_THE_APPS = [
  ["battles_query", { player_tag: "#20JJJ2CCRU", limit: 1 }],
  ["elixir_my_players", {}],
  ["players_names", { player_tags: ["#20JJJ2CCRU"] }],
  ["war_current", { clan_tag: "#J2RGCRVG" }],
];

before(async () => {
  await createScratch(name);
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  accountId = (
    await db.query(
      "insert into account(email_hash,status,role) values ('tool-bridge','approved','member') returning account_id",
    )
  ).rows[0].account_id;
  const session = await createSession(db, {
    secret: "test",
    accountId,
    emailHash: "tool-bridge",
  });
  cookie = `__Host-elixir_session=${session.token}`;
  handler = makeHandler({ databaseUrl, secret: "test" });
});
after(async () => {
  await db?.end();
  await dropScratch(name);
});

const call = (path, tool, args, withCookie = true) =>
  handler(
    {
      path,
      method: "POST",
      headers: {
        ...(withCookie ? { cookie } : {}),
        "x-elixir-client": "web",
        "cloudfront-viewer-address": "8.8.4.4:443",
      },
      body: JSON.stringify({ tool, args }),
    },
    { remainingMs: () => 10_000 },
  );

const audited = async (tool) =>
  (
    await db.query(
      `select count(*)::int n from mcp_call_audit
        where account_id = $1 and tool = $2 and surface = 'web'`,
      [accountId, tool],
    )
  ).rows[0].n;

const hourly = async () =>
  (
    await db.query(
      `select coalesce(sum(count), 0)::int n from rate_limit where bucket = $1`,
      [`mcp#${accountId}`],
    )
  ).rows[0].n;

test("each tool the app calls runs through the bridge, on both paths", async () => {
  for (const path of PATHS)
    for (const [tool, args] of APP_TOOLS) {
      const before = await audited(tool);
      const res = await call(path, tool, args);
      assert.equal(res.statusCode, 200, `${path} ${tool}: ${res.body}`);
      const body = JSON.parse(res.body);
      assert.equal(body.tool, tool);
      assert.ok("is_error" in body && "body" in body, `${path} ${tool}`);
      assert.equal(
        await audited(tool),
        before + 1,
        `${path} ${tool} ran, logged on the web surface`,
      );
    }
});

test("a read-only tool the app does not call is refused before it runs", async () => {
  for (const path of PATHS)
    for (const [tool, args] of NOT_THE_APPS) {
      const spent = await hourly();
      const res = await call(path, tool, args);
      assert.equal(res.statusCode, 400, `${path} ${tool}`);
      assert.equal(JSON.parse(res.body).error, "bad_request");
      assert.equal(await audited(tool), 0, `${path} ${tool} never ran`);
      assert.equal(await hourly(), spent, `${path} ${tool} spent nothing`);
    }
  // Writes, the live lane and unknown names, as before.
  for (const path of PATHS)
    for (const tool of [
      "elixir_follow_player",
      "elixir_send_feedback",
      "live_fetch",
      "no_such_tool",
      "",
    ])
      assert.equal((await call(path, tool, {})).statusCode, 400, tool);
});

test("both paths still need a session", async () => {
  for (const path of PATHS)
    assert.equal(
      (await call(path, "players_summary", {}, false)).statusCode,
      401,
      path,
    );
});
