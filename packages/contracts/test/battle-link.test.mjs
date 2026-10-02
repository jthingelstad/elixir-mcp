import { test } from "node:test";
import assert from "node:assert/strict";
import {
  battleShortId,
  battleShortLength,
  battleUrl,
  parseBattleRef,
} from "../dist/index.js";

const A = "aad68079b0fa" + "1".repeat(52);
const B = "aad68079b0fa7" + "2".repeat(51);

test("a battle's short id is its first 12 characters", () => {
  assert.equal(battleShortId(A), "aad68079b0fa");
  assert.equal(battleShortLength(A, [null, "ff" + "0".repeat(62)]), 12);
});

test("a short id grows past a neighbour that shares it", () => {
  const n = battleShortLength(A, [B, null]);
  assert.equal(n, 13);
  assert.equal(battleShortId(A, n), "aad68079b0fa1");
  assert.equal(battleShortId(B, battleShortLength(B, [A])), "aad68079b0fa7");
});

test("the link is on the one origin", () => {
  assert.equal(
    battleUrl("aad68079b0fa"),
    "https://elixir.poapkings.com/battle/aad68079b0fa",
  );
});

test("a battle ref is a bare id or a link", () => {
  assert.equal(parseBattleRef("aad68079b0fa"), "aad68079b0fa");
  assert.equal(parseBattleRef(A), A);
  assert.equal(
    parseBattleRef("https://elixir.poapkings.com/battle/AAD68079B0FA"),
    "aad68079b0fa",
  );
  assert.equal(
    parseBattleRef("https://elixir.poapkings.com/battle/aad68079b0fa.png"),
    "aad68079b0fa",
  );
  assert.equal(parseBattleRef("aad68079b0f"), null);
  assert.equal(parseBattleRef("not-a-battle"), null);
  assert.equal(parseBattleRef(A + "0"), null);
});
