import { test } from "node:test";
import assert from "node:assert/strict";

test("shrinkage uses the unrounded segment mean before rounding its result", async () => {
  const { ebShrink } = await import("../src/tools/shared.mjs");
  // A reported .527 mean represents 58 wins in 110 observations. Rounding
  // that mean before shrinkage would incorrectly produce .405 here.
  assert.equal(ebShrink(0, 6, 58 / 110), 0.406);
});
