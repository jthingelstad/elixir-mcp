import { test } from "node:test";
import assert from "node:assert/strict";
import { logPath } from "../src/log-path.mjs";
import { makeHttpApp } from "../src/server.mjs";

// An invented feed token in the real one's shape (24 random bytes,
// base64url): never a live one.
const TOKEN = "Zk3v0aQ_x9LmT2bR-7cYw1HdE5uNpJ6s";

test("a path's credentials never reach the log line", () => {
  const cases = {
    "/api/me/home/feed": "/api/me/home/feed",
    [`/api/rss/${TOKEN}`]: "/api/rss/*",
    // A suffix or a short, mistyped token is still a credential's path.
    [`/api/rss/${TOKEN}/`]: "/api/rss/*/",
    "/api/rss/abc": "/api/rss/*",
    "/share/sh_0a1b2c": "/share/*",
    "/api/public/shared-items/sh_0a1b2c": "/api/public/shared-items/*",
    "/a/agent0123/mcp": "/a/*/mcp",
    "/api/agent/agent0123/timeline": "/api/agent/*/timeline",
    // Any long random segment, wherever it sits.
    [`/api/anything/${TOKEN}/more`]: "/api/anything/*/more",
    "/api/me/timeline-items/tl_0123456789abcdef0123":
      "/api/me/timeline-items/*",
    // Route words and tags stay: they name what was asked.
    "/.well-known/oauth-authorization-server":
      "/.well-known/oauth-authorization-server",
    "/api/clan/clans/J2RGCRVG/actions/96":
      "/api/clan/clans/J2RGCRVG/actions/96",
    "/": "/",
  };
  for (const [path, want] of Object.entries(cases))
    assert.equal(logPath(path), want, path);
});

async function logged(dispatch, url, init) {
  const lines = [];
  const info = console.info;
  console.info = (line) => lines.push(line);
  try {
    await makeHttpApp({ dispatch }).request(url, init);
  } finally {
    console.info = info;
  }
  return lines.find((line) => line?.event === "http_request");
}

test("the request line names the door's route, else the masked path", async () => {
  const named = await logged(async (_request, context) => {
    context.route = "/api/rss/*";
    return { statusCode: 200, body: "" };
  }, `https://origin.example/api/rss/${TOKEN}`);
  assert.equal(named.http, "GET /api/rss/*");
  // No route matched (a HEAD the feed's route does not answer).
  const unmatched = await logged(
    async () => ({ statusCode: 404, body: "" }),
    `https://origin.example/api/rss/${TOKEN}`,
    { method: "HEAD" },
  );
  assert.equal(unmatched.http, "HEAD /api/rss/*");
  assert.ok(!JSON.stringify([named, unmatched]).includes(TOKEN));
});

test("the request line says a request was conditional, never the tag it sent", async () => {
  const dispatch = async () => ({ statusCode: 304, body: "" });
  const url = "https://origin.example/api/rss/short";
  const held = await logged(dispatch, url, {
    headers: { "if-none-match": 'W/"a-tag-the-reader-holds"' },
  });
  assert.equal(held.conditional, true);
  assert.ok(!JSON.stringify(held).includes("a-tag-the-reader-holds"));
  const plain = await logged(dispatch, url);
  assert.equal("conditional" in plain, false);
});
