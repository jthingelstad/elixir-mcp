import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RETIRED_RECORDING_ENDPOINTS,
  crPathForJob,
  isRetiredRecordingEndpoint,
  PRODUCT_EMAIL_KINDS,
  ACTIVE_PRODUCT_EMAIL_KINDS,
  isProductEmailKind,
} from "../dist/index.js";

test("obsolete capture has no collector path while retained paths still work", () => {
  for (const endpoint of RETIRED_RECORDING_ENDPOINTS) {
    assert.equal(isRetiredRecordingEndpoint(endpoint), true);
    assert.equal(crPathForJob({ endpoint, entity_key: "global" }), null);
  }
  assert.equal(
    crPathForJob({ endpoint: "player", entity_key: "#P0Y" }),
    "/players/%23P0Y",
  );
});
test("retired mail remains recognizable for historical records only", () => {
  for (const kind of ["top_100", "card_of_week"]) {
    assert.ok(PRODUCT_EMAIL_KINDS.includes(kind));
    assert.equal(isProductEmailKind(kind), true);
    assert.equal(ACTIVE_PRODUCT_EMAIL_KINDS.includes(kind), false);
  }
  assert.ok(ACTIVE_PRODUCT_EMAIL_KINDS.includes("tracking_report"));
});
