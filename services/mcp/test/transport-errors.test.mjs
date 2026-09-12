/**
 * Transport-level refusals carry the tool contract's envelope.
 *
 * A caller that hits a rate limit or a database outage used to get a bare
 * body — {"message":"Internal Server Error"} or {"error":"rate_limited"} —
 * with no code, no hint and no request_id. A five-persona playtest round
 * (2026-09-09) could not tell those apart from a malformed argument, and
 * had nothing to quote in a bug report. These tests pin the envelope on
 * the paths that bypass the invoker.
 *
 * No database is needed: the point is that there ISN'T one.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeHandler } from "../src/handler.mjs";

// Port 1 refuses immediately, so connect() rejects without a timeout.
const DEAD_URL = "postgres://nobody@127.0.0.1:1/nothing";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const handler = makeHandler({
  databaseUrl: DEAD_URL,
  issuer: "https://elixir.poapkings.com",
  sendLoginEmail: async () => {},
});

const event = ({ method = "POST", path, headers = {}, body }) => ({
  rawPath: path,
  requestContext: { http: { method, sourceIp: "9.9.9.9" } },
  headers,
  body,
});

/** Every transport refusal renders {error:{code,message}, meta:{request_id}}. */
function assertEnvelope(res, code) {
  const body = JSON.parse(res.body);
  assert.equal(typeof body.error, "object", "error must be an object");
  assert.equal(body.error.code, code);
  assert.ok(body.error.message.length > 0, "message must not be empty");
  assert.ok(body.error.hint, "a transport refusal must say what to do next");
  assert.match(body.meta.request_id, UUID, "must be reportable");
  assert.ok(body.meta.contract_version, "must carry contract_version");
  assert.ok(body.meta.disclaimer, "must carry the disclaimer");
  assert.ok(body.meta.as_of, "must carry as_of");
  return body;
}

test("a database that will not connect refuses in the contract envelope, not a bare 500", async () => {
  const rejections = [];
  const onRejection = (err) => rejections.push(err);
  process.on("unhandledRejection", onRejection);
  try {
    const res = await handler(
      event({
        path: "/mcp",
        headers: { authorization: "Bearer svt_whatever" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );
    assert.equal(res.statusCode, 503);
    assert.equal(res.headers["retry-after"], "5");
    const body = assertEnvelope(res, "live_unavailable");
    // The caller must learn this is NOT their fault - the whole point.
    assert.match(body.error.message, /not a problem with your request/i);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(rejections, [], "connect() must not escape the handler");
  } finally {
    process.off("unhandledRejection", onRejection);
  }
});

test("the OAuth lane refuses the same way rather than escaping as a 500", async () => {
  const res = await handler(
    event({
      path: "/oauth/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=authorization_code&code=x",
    }),
  );
  assert.equal(res.statusCode, 503);
  assertEnvelope(res, "live_unavailable");
});

test("a refusal never leaks the connection string or an internal stack", async () => {
  const res = await handler(
    event({
      path: "/mcp",
      headers: { authorization: "Bearer svt_whatever" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }),
  );
  assert.doesNotMatch(res.body, /127\.0\.0\.1|postgres:\/\/|ECONNREFUSED/i);
});

test("every request leaves one timing line: door, rpc method, tool, status, request id", async () => {
  const lines = [];
  const realLog = console.log;
  console.log = (line) => lines.push(line);
  try {
    await handler(
      event({
        path: "/a/0123456789ab/mcp",
        headers: { authorization: "Bearer svt_whatever" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "game_clock", arguments: {} },
        }),
      }),
      { awsRequestId: "req-mcp-1" },
    );
    // Not JSON at all: the line still says which door and what status.
    await handler(
      event({
        path: "/oauth/token",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "grant_type=authorization_code&code=x",
      }),
      { awsRequestId: "req-mcp-2" },
    );
  } finally {
    console.log = realLog;
  }
  const timing = lines.map((l) => JSON.parse(l)).filter((l) => l.http);
  assert.equal(timing.length, 2);
  assert.equal(timing[0].http, "POST /a/*/mcp", "never the per-principal id");
  assert.equal(timing[0].rpc, "tools/call");
  assert.equal(timing[0].tool, "game_clock");
  assert.equal(timing[0].status, 503);
  assert.equal(timing[0].request_id, "req-mcp-1");
  assert.equal(typeof timing[0].ms, "number");
  assert.equal(timing[1].http, "POST /oauth/token");
  assert.equal(timing[1].rpc, undefined);
  assert.equal(timing[1].status, 503);
});
