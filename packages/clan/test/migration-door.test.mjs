import { test } from "node:test";
import assert from "node:assert/strict";
import { frozenClanResponse } from "../src/migration-door.mjs";
test("a frozen legacy door stops GET evaluations, all writes, logins and scheduled work", () => {
  for (const path of [
    "/api/clan/me",
    "/api/clan/clans/P0LYQ/actions",
    "/api/clan/auth/login",
  ])
    for (const method of ["GET", "POST", "PUT", "DELETE"])
      assert.equal(
        frozenClanResponse({
          rawPath: path,
          requestContext: { http: { method } },
        }).statusCode,
        503,
      );
  assert.deepEqual(frozenClanResponse({ scheduled: "evaluate" }), {
    skipped: "migration_frozen",
  });
  assert.equal(frozenClanResponse({ rawPath: "/api/clan/health" }), null);
  assert.equal(
    frozenClanResponse({ rawPath: "/api/clan/health", httpMethod: "POST" })
      .statusCode,
    503,
  );
});
