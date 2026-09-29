import { test } from "node:test";
import assert from "node:assert/strict";
import { makeHandler } from "../src/handler.mjs";

// The door itself is tested in packages/collector-door against a scratch
// database; this is the Lambda around it. A route connects before it
// runs, so the requests that reach a route use the admin database the
// other suites use, and a door that asks nothing of it.
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";

function request(method, path, { body, headers = {}, base64 = false } = {}) {
  const raw = body === undefined ? undefined : JSON.stringify(body);
  return {
    rawPath: path,
    requestContext: { http: { method } },
    headers,
    ...(raw === undefined
      ? {}
      : {
          body: base64 ? Buffer.from(raw).toString("base64") : raw,
          isBase64Encoded: base64,
        }),
  };
}

function recordingDoor(answer = { status: 200, body: { ok: true } }) {
  const calls = [];
  const call = (name) => async (db, event, body) => {
    calls.push({ name, body, connected: Boolean(db._connected) });
    return typeof answer === "function" ? answer() : answer;
  };
  return {
    calls,
    config: call("config"),
    lease: call("lease"),
    submit: call("submit"),
  };
}

function captureLog(t) {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(JSON.parse(line)));
  return lines;
}

test("only the three collector routes are served; anything else is a 404 without a connection", async () => {
  const door = recordingDoor();
  const handler = makeHandler({ databaseUrl: ADMIN_URL, door });
  for (const [method, path] of [
    ["GET", "/api/collector/lease"],
    ["POST", "/api/collector/config"],
    ["GET", "/api/me"],
    ["POST", "/api/collector/submit/extra"],
  ]) {
    const res = await handler(request(method, path), {});
    assert.equal(res.statusCode, 404, `${method} ${path}`);
  }
  assert.equal(door.calls.length, 0);
});

test("a request that did not come through CloudFront is refused before anything else", async () => {
  const door = recordingDoor();
  const handler = makeHandler({
    databaseUrl: ADMIN_URL,
    originSecret: ["current-secret", "previous-secret"],
    door,
  });
  const direct = await handler(request("GET", "/api/collector/config"), {});
  assert.equal(direct.statusCode, 403);
  assert.equal(door.calls.length, 0);
});

test("routes reach the door with the parsed body, connected, and answer its status and headers as JSON", async (t) => {
  const lines = captureLog(t);
  const door = recordingDoor({
    status: 429,
    body: { error: "rate_limited" },
    headers: { "retry-after": "7" },
  });
  const handler = makeHandler({
    databaseUrl: ADMIN_URL,
    originSecret: ["current-secret", "previous-secret"],
    door,
  });
  const res = await handler(
    request("POST", "/api/collector/submit", {
      body: { job_id: 1 },
      base64: true,
      // The previous secret still passes, for the minutes of a rotation.
      headers: { "x-elixir-origin": "previous-secret" },
    }),
    { awsRequestId: "req-1", getRemainingTimeInMillis: () => 20_000 },
  );
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers["retry-after"], "7");
  assert.equal(res.headers["cache-control"], "no-store");
  assert.deepEqual(JSON.parse(res.body), { error: "rate_limited" });
  assert.deepEqual(door.calls, [
    { name: "submit", body: { job_id: 1 }, connected: true },
  ]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].http, "POST /api/collector/submit");
  assert.equal(lines[0].status, 429);
  assert.equal(lines[0].request_id, "req-1");
  assert.equal(lines[0].timed_out, undefined);
});

test("a body that is not JSON is a 400 before the door runs", async () => {
  const door = recordingDoor();
  const handler = makeHandler({ databaseUrl: ADMIN_URL, door });
  const res = await handler(
    { ...request("POST", "/api/collector/lease"), body: "{nope" },
    {},
  );
  assert.equal(res.statusCode, 400);
  assert.equal(door.calls.length, 0);
});

test("a door that runs past the soft deadline is answered 504 and logged as timed out", async (t) => {
  const lines = captureLog(t);
  const door = recordingDoor(() => new Promise(() => {}));
  const handler = makeHandler({ databaseUrl: ADMIN_URL, door });
  const res = await handler(request("GET", "/api/collector/config"), {
    // 1.5 s margin: the door gets about a quarter of a second.
    getRemainingTimeInMillis: () => 1750,
  });
  assert.equal(res.statusCode, 504);
  assert.deepEqual(JSON.parse(res.body), { error: "timeout" });
  assert.equal(lines[0].status, 504);
  assert.equal(lines[0].timed_out, true);
});
