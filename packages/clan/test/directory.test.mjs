// The clan directory's route (#768): any signed-in person, with a clan or
// none; the reader (the approved seam) decides who reads and what a tile is.
import test from "node:test";
import assert from "node:assert/strict";
import { cookieHeader, fakeMcp, harness, req, signIn } from "./fakes.mjs";

const TILES = { schema_version: 1, clans: [], truncated: false };

test("signed out reads nothing, and the reader is never asked", async () => {
  let reads = 0;
  const h = harness({
    directory: async () => {
      reads++;
      return { directory: TILES };
    },
  });
  const r = await h.handler(req("GET", "/api/directory"));
  assert.equal(r.statusCode, 401);
  assert.equal(reads, 0);
});

test("a signed-in person reads the tiles, at the mounted path too", async () => {
  let reads = 0;
  const h = harness({
    mcp: fakeMcp(),
    directory: async () => {
      reads++;
      return { directory: TILES };
    },
  });
  const { sessionCookie } = await signIn(h);
  const cookies = cookieHeader(sessionCookie);
  for (const path of ["/api/directory", "/api/clan/directory"]) {
    const r = await h.handler(req("GET", path, { cookies }));
    assert.equal(r.statusCode, 200, path);
    assert.deepEqual(JSON.parse(r.body), TILES);
    assert.equal(r.headers["cache-control"], "no-store");
  }
  assert.equal(reads, 2);
  // No other verb.
  const post = await h.handler(req("POST", "/api/directory", { cookies }));
  assert.equal(post.statusCode, 404);
});

test("the reader's refusal is a 403 with its reason", async () => {
  const h = harness({
    mcp: fakeMcp(),
    directory: async () => ({ refused: "not_a_person" }),
  });
  const { sessionCookie } = await signIn(h);
  const r = await h.handler(
    req("GET", "/api/directory", { cookies: cookieHeader(sessionCookie) }),
  );
  assert.equal(r.statusCode, 403);
  assert.deepEqual(JSON.parse(r.body), { error: "not_a_person" });
});

test("without the reader wired the route does not exist", async () => {
  const h = harness({ mcp: fakeMcp() });
  const { sessionCookie } = await signIn(h);
  const r = await h.handler(
    req("GET", "/api/directory", { cookies: cookieHeader(sessionCookie) }),
  );
  assert.equal(r.statusCode, 404);
});
