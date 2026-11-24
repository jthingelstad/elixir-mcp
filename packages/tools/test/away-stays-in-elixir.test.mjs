/**
 * An away is the clan's since 2026-11-24 (an Away exception is always one
 * the whole clan sees), and it stays in Elixir: no cross-post carries it,
 * while the clan's other facts keep the rule they had.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { isPublishable, itemVisibility } from "../src/activity/entries.mjs";

test("an away is the clan's to see and never leaves Elixir", () => {
  const away = { kind: "member_away", section: "attested" };
  const departure = { kind: "departure_classified", section: "attested" };
  assert.equal(itemVisibility(away), "clan");
  assert.equal(isPublishable(away), false);
  assert.equal(itemVisibility(departure), "clan");
  assert.equal(isPublishable(departure), true);
});
