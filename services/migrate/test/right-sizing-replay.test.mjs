import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync, gunzipSync } from "node:zlib";
import { observerEvidence } from "../../../infra/scripts/right-sizing-observers.mjs";
import {
  prepareBattlelogRewrite,
  verifyBattlelogReplacement,
} from "../../../infra/scripts/right-sizing-replay.mjs";
import { archiveKey } from "../../../packages/ingest/src/pipeline.mjs";
import { payloadHash } from "../../../packages/ingest/src/hash.mjs";

function fixture() {
  const card = { id: 26000000, name: "Knight", level: 9, maxLevel: 14 };
  const payload = [
    {
      battleTime: "20261002T110000.000Z",
      type: "PvP",
      team: [
        { tag: "#P0LYQ", cards: [card] },
        { tag: "#P2LQ0", cards: [card] },
      ],
      opponent: [
        { tag: "#P8LQ0", cards: [card] },
        { tag: "#P9LQ0", cards: [card] },
      ],
      gameMode: { name: "Two versus two" },
    },
    {
      battleTime: "20261002T120000.000Z",
      type: "riverRaceDuel",
      team: [
        {
          tag: "#P0LYQ",
          rounds: [
            { cards: [card], crowns: 3 },
            { cards: [card], crowns: 1 },
          ],
        },
      ],
      opponent: [
        {
          tag: "#P8LQ0",
          rounds: [
            { cards: [card], crowns: 0 },
            { cards: [card], crowns: 0 },
          ],
        },
      ],
    },
    {
      battleTime: "20261002T130000.000Z",
      type: "boatBattle",
      boatBattleWon: true,
      team: [{ tag: "#P0LYQ", cards: [card] }],
      opponent: [{ cards: [card], crowns: 0 }],
      boat: { untouched: true },
    },
    {
      battleTime: "20261002T140000.000Z",
      type: "PvP",
      team: [{ tag: "#P0LYQ", cards: [card] }],
      opponent: [{ tag: "#P8LQ0", cards: [card] }],
    },
  ];
  const compressed = gzipSync(JSON.stringify(payload));
  const item = {
    kind: "version",
    key: archiveKey(
      "player_battlelog",
      "#P0LYQ",
      "2026-10-02T15:00:00.000Z",
      payloadHash(payload),
    ),
    version_id: "old-exact-version",
    bytes: compressed.length,
  };
  const evidence = observerEvidence(item, compressed);
  const decisions = evidence.battles.map((b, i) => ({
    battle_id: b.battle_id,
    disposition: i === 3 ? "removable" : i === 2 ? "unresolved" : "retained",
  }));
  return { item, compressed, evidence, decisions, payload };
}
test("mixed replay keeps whole team, duel and boat entries including unresolved history", () => {
  const f = fixture();
  const { bytes, receipt } = prepareBattlelogRewrite(f);
  assert.deepEqual(JSON.parse(gunzipSync(bytes)), f.payload.slice(0, 3));
  assert.equal(receipt.removed_entries, 1);
  assert.equal(receipt.retained_entries, 3);
  assert.equal(receipt.unresolved_entries, 1);
  assert.notEqual(receipt.replacement.key, f.item.key);
  assert.equal(
    receipt.replacement.key.split("-").slice(0, -1).join("-"),
    f.item.key.split("-").slice(0, -1).join("-"),
  );
  assert.deepEqual(prepareBattlelogRewrite(f).bytes, bytes);
  assert.equal(
    verifyBattlelogReplacement(receipt, bytes).payload_hash,
    receipt.replacement.payload_hash,
  );
  const sameJSON = gzipSync(JSON.stringify(f.payload.slice(0, 3)), {
    level: 1,
  });
  assert.equal(
    verifyBattlelogReplacement(receipt, sameJSON).payload_hash,
    receipt.replacement.payload_hash,
  );
  assert.throws(
    () => verifyBattlelogReplacement(receipt, f.compressed),
    /hash differs/,
  );
});
test("altered versions, incomplete, extra and contradictory classifications fail before staging", () => {
  const f = fixture();
  assert.throws(
    () =>
      prepareBattlelogRewrite({
        ...f,
        item: { ...f.item, version_id: "other" },
      }),
    /evidence changed/,
  );
  assert.throws(
    () =>
      prepareBattlelogRewrite({
        ...f,
        evidence: { ...f.evidence, compressed_sha256: "0".repeat(64) },
      }),
    /evidence changed/,
  );
  assert.throws(
    () => prepareBattlelogRewrite({ ...f, decisions: f.decisions.slice(1) }),
    /cover exactly/,
  );
  assert.throws(
    () =>
      prepareBattlelogRewrite({
        ...f,
        decisions: [
          ...f.decisions,
          { battle_id: "0".repeat(64), disposition: "retained" },
        ],
      }),
    /cover exactly/,
  );
  assert.throws(
    () =>
      prepareBattlelogRewrite({
        ...f,
        decisions: [...f.decisions, f.decisions[0]],
      }),
    /duplicate/,
  );
  for (const disposition of ["retained", "removable"])
    assert.throws(
      () =>
        prepareBattlelogRewrite({
          ...f,
          decisions: f.decisions.map((d) => ({ ...d, disposition })),
        }),
      /both retained/,
    );
  assert.throws(
    () =>
      prepareBattlelogRewrite({
        ...f,
        decisions: f.decisions.map((d) => ({ ...d, disposition: "delete" })),
      }),
    /invalid/,
  );
});
