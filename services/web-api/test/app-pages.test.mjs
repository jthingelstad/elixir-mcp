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
