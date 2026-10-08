/**
 * An address the site does not build: the edge fails over from the
 * site bucket to this API, which answers the site's 404 page with a true
 * 404 (routes/site-miss.mjs). No database: a miss never opens one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeHandler } from "../src/handler.mjs";
import { FALLBACK_PAGE, makeSiteMiss } from "../src/routes/site-miss.mjs";

const PAGE = "<!doctype html><title>Page not found - Elixir</title>";
const event = (method, path) => ({
  rawPath: path,
  requestContext: { http: { method } },
  headers: {},
});
// An unreachable database: the test fails loudly if a miss opens one.
const databaseUrl = "postgres://nobody@127.0.0.1:1/none";

test("a site miss is the site's 404 page with a true 404", async () => {
  const handler = makeHandler({
    databaseUrl,
    secret: "test",
    siteMiss: makeSiteMiss(async () => PAGE),
  });
  for (const path of [
    "/nonexistent-page/index.html",
    "/docs/not-a-page/index.html",
    "/assets/not-a-real-file.js",
  ]) {
    const res = await handler(event("GET", path));
    assert.equal(res.statusCode, 404, path);
    assert.match(res.headers["content-type"], /^text\/html/);
    assert.equal(res.body, PAGE);
  }
  const head = await handler(event("HEAD", "/nonexistent-page/index.html"));
  assert.equal(head.statusCode, 404);
  assert.equal(head.body, "");
});

test("an API path keeps its JSON refusal", async () => {
  const handler = makeHandler({
    databaseUrl,
    secret: "test",
    siteMiss: makeSiteMiss(async () => PAGE),
  });
  const res = await handler(event("GET", "/api/definitely-not-a-route"));
  assert.equal(res.statusCode, 404);
  assert.match(res.headers["content-type"], /application\/json/);
  // A write is never a page either.
  const post = await handler(event("POST", "/nonexistent-page/index.html"));
  assert.match(post.headers["content-type"], /application\/json/);
});

test("an unreadable page still answers a page, with the disclaimer", async () => {
  const miss = makeSiteMiss(async () => {
    throw new Error("NoSuchKey");
  });
  const res = await miss("GET");
  assert.equal(res.statusCode, 404);
  assert.equal(res.body, FALLBACK_PAGE);
  assert.match(FALLBACK_PAGE, /not endorsed by Supercell/);
  assert.equal((await makeSiteMiss(null)("GET")).body, FALLBACK_PAGE);
});
