import { test } from "node:test";
import assert from "node:assert/strict";
import { medianSortedScores } from "../src/level-curve.mjs";

test("cohort median averages both middle scores for even-sized populations", () => {
  assert.equal(medianSortedScores([-0.5, -0.3, -0.1, 0.1, 0.3, 0.5]), 0);
  assert.equal(medianSortedScores([-0.5, -0.1, 0.3]), -0.1);
  assert.equal(medianSortedScores([0.2]), 0.2);
  assert.equal(medianSortedScores([]), null);
});
