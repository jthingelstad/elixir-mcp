import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RETIRED_RECORDING_ENDPOINTS,
  crPathForJob,
  isRetiredRecordingEndpoint,
  PRODUCT_EMAIL_KINDS,
  ACTIVE_PRODUCT_EMAIL_KINDS,
  isProductEmailKind,
  isActiveEmailKind,
  inactiveEmailReason,
  DIGEST_EMAIL_KINDS,
  isDigestEmailKind,
  emailKindDefault,
} from "../dist/index.js";

test("obsolete capture has no collector path while retained paths still work", () => {
  for (const endpoint of RETIRED_RECORDING_ENDPOINTS) {
    assert.equal(isRetiredRecordingEndpoint(endpoint), true);
    assert.equal(crPathForJob({ endpoint, entity_key: "global" }), null);
  }
  // Retired 2026-11-13: a stale tournaments job gets no path.
  assert.ok(RETIRED_RECORDING_ENDPOINTS.includes("globaltournaments"));
  assert.equal(
    crPathForJob({ endpoint: "globaltournaments", entity_key: "GLOBAL" }),
    null,
  );
  assert.equal(
    crPathForJob({ endpoint: "player", entity_key: "#00J" }),
    "/players/%2300J",
  );
});
test("the removed mail kinds are no kind at all; the folded ones stay retired", () => {
  // Top 100 and Card of the Week, removed 2026-11-14 (Jamie: "Remove
  // those email kinds."): no send path, label or switch knows them.
  for (const kind of ["top_100", "card_of_week"]) {
    assert.equal(PRODUCT_EMAIL_KINDS.includes(kind), false);
    assert.equal(isProductEmailKind(kind), false);
    assert.equal(isActiveEmailKind(kind), false);
    assert.equal(inactiveEmailReason(kind), "unknown_kind");
  }
  for (const kind of ["clan_report", "arena_week", "milestone"]) {
    assert.equal(isProductEmailKind(kind), true);
    assert.equal(isActiveEmailKind(kind), false);
    assert.equal(inactiveEmailReason(kind), "retired");
  }
  assert.ok(ACTIVE_PRODUCT_EMAIL_KINDS.includes("tracking_report"));
  assert.equal(isActiveEmailKind("tracking_report"), true);
});

test("three digests, each its own active kind; the daily brief starts off", () => {
  // Jamie, 2026-11-26: "three unique emails at three different
  // frequencies ... I should be able to select all or none of them."
  assert.deepEqual(
    [...DIGEST_EMAIL_KINDS],
    ["digest_daily", "tracking_report", "digest_season"],
  );
  for (const kind of DIGEST_EMAIL_KINDS) {
    assert.equal(isActiveEmailKind(kind), true, kind);
    assert.equal(isDigestEmailKind(kind), true, kind);
  }
  assert.equal(isDigestEmailKind("collector_activity"), false);
  assert.equal(emailKindDefault("digest_daily"), false);
  assert.equal(emailKindDefault("tracking_report"), true);
  assert.equal(emailKindDefault("digest_season"), true);
});
