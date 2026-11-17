/**
 * Which paths the web API renders as the app. The folded Console, Ladder
 * and the old service page left on 2026-11-13: CloudFront no longer routes
 * them here, and a site-bucket miss that fails over here with such a path
 * must reach the site's 404 (routes/site-miss.mjs), never the app shell.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeAppPages } from "../src/app-pages.mjs";

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

test("member session links keep their sign-in wall and never forward to a public history", async () => {
  for (const authenticated of [true, false]) {
    const render = async ({ url, me }) =>
      `${authenticated}:${me.data.authenticated}:${url}`;
    const pages = makeAppPages({
      dispatch: async () => ({
        statusCode: 200,
        body: JSON.stringify({ authenticated }),
      }),
      render,
      shell: async () => '<div id="root"></div>',
    });
    const result = await pages({
      method: "GET",
      path: "/home/player/0PQRV/session/tl_00000000000000000001",
      headers: {},
      rawQueryString: "at=2026-11-16T14%3A05%3A07Z",
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.headers.location, undefined);
    assert.match(
      result.body,
      new RegExp(`${authenticated}:${authenticated}:/home/player/`),
    );
    assert.equal(result.headers["cache-control"], "private, no-store");
  }
});
