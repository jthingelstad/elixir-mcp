import { test } from "node:test";
import assert from "node:assert/strict";
import { deadlineMs } from "../src/deadline.mjs";
test("the longer shared Clan runtime only extends model operations", () => {
  const context = { remainingMs: () => 30_000 };
  for (const path of [
    "/api/public/status",
    "/api/clan/me",
    "/api/clan/clans/00UQG/actions",
    "/api/clan/clans/00UQG/model",
  ])
    assert.equal(deadlineMs(context, { path, method: "GET" }), 18_500);
  for (const path of [
    "/api/clan/clans/00UQG/model",
    "/api/clan/clans/00UQG/actions/37/draft",
    "/api/clan/clans/00UQG/recruit/draft",
  ])
    assert.equal(deadlineMs(context, { path, method: "POST" }), 28_500);
  assert.equal(deadlineMs({ remainingMs: () => 1501 }), 1);
});
