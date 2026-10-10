/** What a use of the clan's model costs, from its tokens (`prices.mjs`). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { roundUsd, costOfUse } from "@elixir-mcp/clan/manage/prices.mjs";

const usd = (...a) => roundUsd(costOfUse(...a).usd);

test("prices: list rates per million tokens, input and output", () => {
  assert.equal(usd("claude-sonnet-5", 1_000_000, 0), 2);
  assert.equal(usd("claude-sonnet-5", 0, 1_000_000), 10);
  assert.equal(usd("claude-sonnet-5-5", 1000, 1000), 0.012);
  assert.equal(usd("claude-opus-5-5", 1000, 1000), 0.024);
  assert.equal(usd("claude-fable-5-1", 1000, 1000), 0.06);
  assert.equal(costOfUse("claude-opus-5", 1, 1).estimated, false);
});

test("prices: a dated id is priced as its model", () => {
  assert.equal(usd("claude-haiku-4-5-20251001", 1000, 1000), 0.006);
  assert.equal(costOfUse("claude-haiku-4-5-20251001", 1, 1).estimated, false);
});

test("prices: Claude Haiku 5.5 pays its higher rates over 100,000 prompt tokens", () => {
  assert.equal(usd("claude-haiku-5-5", 100_000, 1000), 0.0105);
  assert.equal(usd("claude-haiku-5-5", 200_000, 1000), 0.1025);
});

test("prices: a model missing from the table errs high and says so", () => {
  const haiku = costOfUse("claude-haiku-6", 1000, 1000);
  assert.equal(haiku.estimated, true);
  assert.equal(roundUsd(haiku.usd), 0.006, "the dearest Haiku");
  assert.equal(usd("claude-opus-6", 1000, 1000), 0.09, "the dearest Opus");
  assert.equal(usd("claude-new-thing", 1000, 1000), 0.09, "the dearest of all");
});

test("prices: a use that reported no tokens has no cost", () => {
  assert.equal(costOfUse("claude-sonnet-5", null, null), null);
  assert.equal(usd("claude-sonnet-5", 1000, null), 0.002);
});
