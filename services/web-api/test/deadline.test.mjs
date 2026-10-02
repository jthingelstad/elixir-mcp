import { test } from "node:test";
import assert from "node:assert/strict";
import { deadlineMs } from "../src/deadline.mjs";
test("the longer shared Clan runtime only extends model operations", () => {
  const context = { getRemainingTimeInMillis: () => 30_000 };
  for (const rawPath of [
    "/api/public/status",
    "/api/clan/me",
    "/api/clan/clans/P0LYQ/actions",
    "/api/clan/clans/P0LYQ/model",
  ])
    assert.equal(deadlineMs(context, { rawPath, httpMethod: "GET" }), 18_500);
  for (const rawPath of [
    "/api/clan/clans/P0LYQ/model",
    "/api/clan/clans/P0LYQ/actions/37/draft",
    "/api/clan/clans/P0LYQ/recruit/draft",
  ])
    assert.equal(deadlineMs(context, { rawPath, httpMethod: "POST" }), 28_500);
  assert.equal(deadlineMs({ getRemainingTimeInMillis: () => 1501 }), 1);
});
