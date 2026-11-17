/**
 * Which paths the web API renders as the app. The folded Console, Ladder
 * and the old service page left on 2026-11-13: CloudFront no longer routes
 * them here, and a site-bucket miss that fails over here with such a path
 * must reach the site's 404 (routes/site-miss.mjs), never the app shell.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeAppPages, publicSessionFrom } from "../src/app-pages.mjs";

test("retired app paths are passed through, never rendered", async () => {
  const seen = [];
  const pages = makeAppPages({
    dispatch: async (request) => {
      seen.push(request.path);
      return { statusCode: 404, headers: {}, body: "miss" };
    },
    shell: async () => {
      throw new Error("the app shell was read");
    },
    render: async () => {
      throw new Error("the app was rendered");
    },
  });
  for (const path of [
    "/console",
    "/console/index.html",
    "/console/account/overview/index.html",
    "/ladder",
    "/ladder/decks/index.html",
    "/data/service",
    "/data/service/index.html",
  ]) {
    const res = await pages({ method: "GET", path, headers: {} });
    assert.equal(res.body, "miss", path);
    assert.equal(seen.at(-1), path);
  }
});

/** Home's own address forwards to the Timeline for good (2026-11-17). If
 *  this redirect is dropped, every digest, Discord post, push and bookmark
 *  that names /home stops landing on the feed. */
test("/home forwards to /timeline with its query; pages under /home stay", async () => {
  const seen = [];
  const pages = makeAppPages({
    dispatch: async (request) => {
      seen.push(request.path);
      return { statusCode: 200, headers: {}, body: '{"authenticated":false}' };
    },
    shell: async () => '<html><div id="root"></div></html>',
    render: async ({ url }) => `rendered ${url}`,
  });
  for (const [path, qs, location] of [
    ["/home", undefined, "/timeline"],
    ["/home/", undefined, "/timeline"],
    ["/home", "bell", "/timeline?bell"],
    ["/home", "search", "/timeline?search"],
    ["/home", "chip=friends&new=1", "/timeline?chip=friends&new=1"],
  ]) {
    for (const method of ["GET", "HEAD"]) {
      const res = await pages({
        method,
        path,
        headers: {},
        ...(qs ? { rawQueryString: qs } : {}),
      });
      assert.equal(res.statusCode, 301, `${method} ${path}?${qs}`);
      assert.equal(res.headers.location, location);
      assert.equal(res.headers["cache-control"], "no-store");
    }
  }
  assert.deepEqual(seen, [], "a redirect reads no session");
  // Every page under /home keeps its address and renders.
  for (const path of [
    "/home/find",
    "/home/you",
    "/home/you/stats",
    "/home/player/0PQRV",
    "/home/player/0PQRV/session/abc",
    "/home/account/a1b2",
    "/home/@someone",
    "/home/passport",
    "/home/follow/0PQRV",
    "/timeline",
  ]) {
    const res = await pages({ method: "GET", path, headers: {} });
    assert.equal(res.statusCode, 200, path);
    assert.match(
      res.body,
      new RegExp(`rendered ${path.replace(/\//g, "\\/")}`),
    );
  }
});

test("the Timeline reached through the site's failover gets the bare shell", async () => {
  const pages = makeAppPages({
    dispatch: async () => {
      throw new Error("a session was read without its cookie");
    },
    shell: async () => '<html><div id="root"></div></html>',
    render: async () => {
      throw new Error("the app was rendered without its session");
    },
  });
  const res = await pages({
    method: "GET",
    path: "/timeline/index.html",
    headers: {},
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["cache-control"], "private, no-store");
  assert.equal(res.body, '<html><div id="root"></div></html>');
  assert.doesNotMatch(res.body, /elixir-bootstrap/);
});

/** A session's signed-in address, as mail, the bell, Discord and RSS have
 *  sent it since 2026-11-16 (2026-11-17): signed out it forwards to the
 *  session's public page, never a sign-in wall; signed in it is the
 *  member's page as before. */
test("an old session link: signed out to its public page, signed in rendered", async () => {
  const id = `tl_${"a1".repeat(10)}`;
  const at = "2026-11-16T14:05:07.000Z";
  const start = Math.floor(Date.parse(at) / 1000);
  const old = `/home/player/0PQRV/session/${id}`;
  const pages = (authenticated) =>
    makeAppPages({
      dispatch: async () => ({
        statusCode: 200,
        headers: {},
        body: JSON.stringify({ authenticated }),
      }),
      shell: async () => '<html><div id="root"></div></html>',
      render: async ({ url }) => `rendered ${url}`,
    });
  for (const request of [
    {
      queryStringParameters: { at },
      rawQueryString: `at=${encodeURIComponent(at)}`,
    },
    { rawQueryString: `at=${encodeURIComponent(at)}` },
  ]) {
    const out = await pages(false)({
      method: "GET",
      path: old,
      headers: {},
      ...request,
    });
    assert.equal(out.statusCode, 302);
    assert.equal(out.headers.location, `/session/0PQRV/${id}/${start}`);
    assert.equal(out.headers["cache-control"], "private, no-store");
    const inside = await pages(true)({
      method: "GET",
      path: old,
      headers: {},
      ...request,
    });
    assert.equal(inside.statusCode, 200);
    assert.match(inside.body, /rendered \/home\/player\/0PQRV\/session\//);
  }
  assert.equal(
    publicSessionFrom({ path: `${old}/`, queryStringParameters: { at } }),
    `/session/0PQRV/${id}/${start}`,
  );
  // Without its start, or not a session's id, it stays the app's page.
  for (const request of [
    { path: old },
    { path: old, queryStringParameters: { at: "nonsense" } },
    { path: "/home/player/0PQRV/session/abc", queryStringParameters: { at } },
    {
      path: `/home/player/%E0%A4%A/session/${id}`,
      queryStringParameters: { at },
    },
  ])
    assert.equal(publicSessionFrom(request), null, JSON.stringify(request));
});
