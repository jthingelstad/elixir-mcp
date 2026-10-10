import { test } from "node:test";
import assert from "node:assert/strict";
import { readTimelineEvidence } from "../src/activity/entries.mjs";

// The refusals an evidence page read names before it touches the
// database (docs/timeline, Recorded evidence). A healthy acceptance run
// produces none of them, so the docs audit allows them and this pins them.
test("an evidence page read refuses a bad page, a later page without a version, and an item without evidence", async () => {
  assert.deepEqual(await readTimelineEvidence(null, {}, { offset: -1 }), {
    error: "invalid_page",
  });
  assert.deepEqual(await readTimelineEvidence(null, {}, { limit: 26 }), {
    error: "invalid_page",
  });
  assert.deepEqual(await readTimelineEvidence(null, {}, { offset: 25 }), {
    error: "version_required",
  });
  assert.deepEqual(await readTimelineEvidence(null, { id: "x" }), {
    error: "evidence_unavailable",
  });
});
