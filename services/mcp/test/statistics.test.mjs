import { test } from "node:test";
import assert from "node:assert/strict";
import { medianSortedScores } from "../src/level-curve.mjs";

test("cohort median averages both middle scores for even-sized populations", () => {
  assert.equal(medianSortedScores([-0.5, -0.3, -0.1, 0.1, 0.3, 0.5]), 0);
  assert.equal(medianSortedScores([-0.5, -0.1, 0.3]), -0.1);
  assert.equal(medianSortedScores([0.2]), 0.2);
  assert.equal(medianSortedScores([]), null);
});

test("shrinkage uses the unrounded segment mean before rounding its result", async () => {
  const { ebShrink } = await import("../src/tools/shared.mjs");
  // A reported .527 mean represents 58 wins in 110 observations. Rounding
  // that mean before shrinkage would incorrectly produce .405 here.
  assert.equal(ebShrink(0, 6, 58 / 110), 0.406);
});
