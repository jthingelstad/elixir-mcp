/**
 * The app's tool bridge answers the app's own tools and nothing else
 * (2026-11-14). It used to open every read-only tool to the browser, a
 * leftover of the Console's Explore page; now a read-only tool the app
 * does not call is refused before it runs, as an unknown one is, and
 * spends nothing of the hourly bucket. Since 2026-11-28 a bridged read is
 * site usage (Jamie): no call-log row, the website's own hourly bucket
 * (`web#`), and one operational line. POST /api/explore, the old path,
 * is gone (2026-11-14, after the day it stayed for tabs loaded before the
 * rename): it is a 404 like any unknown address.
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
const OLD_ROUTE = "/api/explore";
const PATHS = [ROUTE];

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

const audited = async () =>
  (
    await db.query(
      `select count(*)::int n from mcp_call_audit where account_id = $1`,
      [accountId],
    )
  ).rows[0].n;

const spentOn = async (bucket) =>
  (
    await db.query(
      `select coalesce(sum(count), 0)::int n from rate_limit where bucket = $1`,
      [bucket],
    )
  ).rows[0].n;
const hourly = () => spentOn(`web#${accountId}`);

/** The `web_read` lines a call leaves on stdout, parsed. */
async function withLines(run) {
  const lines = [];
  const info = console.info;
  console.info = (line) => lines.push(line);
  try {
    const res = await run();
    return {
      res,
      reads: lines
        .filter((l) => typeof l === "string" && l.includes('"web_read"'))
        .map((l) => JSON.parse(l)),
    };
  } finally {
    console.info = info;
  }
}

test("each tool the app calls runs through the bridge, with no call-log row and one log line", async () => {
  for (const path of PATHS)
    for (const [tool, args] of APP_TOOLS) {
      const before = await hourly();
      const { res, reads } = await withLines(() => call(path, tool, args));
      assert.equal(res.statusCode, 200, `${path} ${tool}: ${res.body}`);
      const body = JSON.parse(res.body);
      assert.equal(body.tool, tool);
      assert.ok("is_error" in body && "body" in body, `${path} ${tool}`);
      assert.equal(await hourly(), before + 1, `${path} ${tool} spent web#`);
      assert.equal(reads.length, 1, `${path} ${tool}: one web_read line`);
      const [line] = reads;
      assert.equal(line.door, "tool");
      assert.equal(line.tool, tool);
      for (const k of ["ms", "db_ms", "db_queries"])
        assert.equal(typeof line[k], "number", k);
      // Never the tag, the nickname, the query or the account.
      const text = JSON.stringify(line);
      for (const secret of ["20JJJ2CCRU", "J2RGCRVG", "King", accountId])
        assert.ok(!text.includes(secret), `${tool}: ${text}`);
    }
  assert.equal(await audited(), 0, "nothing in the call log");
  assert.equal(
    await spentOn(`mcp#${accountId}`),
    0,
    "the MCP door's bucket is untouched",
  );
});

test("a full website bucket refuses the bridge; a full MCP bucket does not", async () => {
  const hour = new Date();
  hour.setUTCMinutes(0, 0, 0);
  const fill = (bucket) =>
    db.query(
      `insert into rate_limit (bucket, window_start, count) values ($1, $2, 100000)
       on conflict (bucket, window_start) do update set count = 100000`,
      [bucket, hour.toISOString()],
    );
  const read = () =>
    call(ROUTE, "players_summary", { player_tag: "#20JJJ2CCRU" });
  await fill(`mcp#${accountId}`);
  assert.equal((await read()).statusCode, 200, "MCP's hour is not the site's");
  await fill(`web#${accountId}`);
  const refused = await read();
  assert.equal(refused.statusCode, 429);
  assert.deepEqual(JSON.parse(refused.body), { error: "rate_limited" });
  await db.query("delete from rate_limit where bucket = any($1)", [
    [`mcp#${accountId}`, `web#${accountId}`],
  ]);
});

test("a read-only tool the app does not call is refused before it runs", async () => {
  for (const path of PATHS)
    for (const [tool, args] of NOT_THE_APPS) {
      const spent = await hourly();
      const res = await call(path, tool, args);
      assert.equal(res.statusCode, 400, `${path} ${tool}`);
      assert.equal(JSON.parse(res.body).error, "bad_request");
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

test("the bridge needs a session", async () => {
  for (const path of PATHS)
    assert.equal(
      (await call(path, "players_summary", {}, false)).statusCode,
      401,
      path,
    );
});

test("the old path is gone: a 404, and nothing runs", async () => {
  const before = await hourly();
  for (const withCookie of [true, false]) {
    const res = await call(
      OLD_ROUTE,
      "players_summary",
      { player_tag: "#20JJJ2CCRU" },
      withCookie,
    );
    assert.equal(res.statusCode, 404, res.body);
  }
  assert.equal(await hourly(), before);
});
