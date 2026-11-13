import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTag,
  isCanonicalTag,
  InvalidTagError,
} from "../dist/index.js";

test("accepts canonical input unchanged", () => {
  assert.equal(normalizeTag("#09CV8UVL"), "#09CV8UVL");
});

test("adds missing hash prefix", () => {
  assert.equal(normalizeTag("09CV8UVL"), "#09CV8UVL");
  // A request body's field may be missing: refused, never a TypeError.
  assert.throws(() => normalizeTag(undefined), { code: "invalid_tag" });
  assert.throws(() => normalizeTag(null), { code: "invalid_tag" });
});

test("uppercases and folds letter O to zero", () => {
  assert.equal(normalizeTag("#o9cv8uvl"), "#09CV8UVL");
});

test("trims surrounding whitespace", () => {
  assert.equal(normalizeTag("  #09CV8UVL "), "#09CV8UVL");
});

test("rejects characters outside the CR alphabet", () => {
  for (const bad of [
    "#09CV1UVL",
    "#ABC!23",
    "#WXYZ0000",
    "#0RG2'--",
    "#0CR 0V9",
  ]) {
    assert.throws(() => normalizeTag(bad), InvalidTagError);
  }
});

test("rejects too-short and too-long tags", () => {
  assert.throws(() => normalizeTag("#22"), InvalidTagError);
  assert.throws(() => normalizeTag("#" + "2".repeat(13)), InvalidTagError);
});

test("InvalidTagError carries the structured code", () => {
  try {
    normalizeTag("bogus!");
    assert.fail("should have thrown");
  } catch (err) {
    assert.equal(err.code, "invalid_tag");
  }
});

test("isCanonicalTag is strict — no folding", () => {
  assert.equal(isCanonicalTag("#09CV8UVL"), true);
  assert.equal(isCanonicalTag("09CV8UVL"), false);
  assert.equal(isCanonicalTag("#09cv8uvl"), false);
});
