import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { payloadHash } from "../../../packages/ingest/src/hash.mjs";
import { canonicalizeBattle } from "../../../packages/ingest/src/battles.mjs";
import {
  observerEvidence,
  mapObservers,
} from "../../../infra/scripts/right-sizing-observers.mjs";
const sha = (b) => createHash("sha256").update(b).digest("hex");
function data() {
  const battle = {
    battleTime: "20261002T120000.000Z",
    type: "riverRaceDuel",
    team: [{ tag: "#P0LYQ", cards: [], rounds: [] }],
    opponent: [{ tag: "#P2LQ0", cards: [] }],
  };
  const payload = [battle],
    bytes = gzipSync(JSON.stringify(payload));
  const item = {
    kind: "version",
    key: `payloads/endpoint=player_battlelog/entity=P0LYQ/dt=2026-10-02/20261002T120001Z-${payloadHash(payload).slice(0, 16)}.json.gz`,
    version_id: "old-version",
    bytes: bytes.length,
  };
  return { battle, bytes, item };
}
test("the exact old version yields observer and ingest-equivalent IDs without decks or names", () => {
  const { battle, bytes, item } = data(),
    e = observerEvidence(item, bytes);
  assert.equal(e.version_id, "old-version");
  assert.equal(e.observer_tag, "#P0LYQ");
  assert.equal(
    e.battles[0].battle_id,
    canonicalizeBattle(battle).battle.battle_id,
  );
  assert.equal(e.compressed_sha256, sha(bytes));
  assert.equal(JSON.stringify(e).includes('"cards"'), false);
  assert.throws(
    () =>
      observerEvidence(
        {
          ...item,
          key: item.key.replace(/-[a-f0-9]{16}/, "-0000000000000000"),
        },
        bytes,
      ),
    /hash differs/,
  );
});
test("all versions are mapped, failed reads remain unresolved, and altered inventories refuse", async () => {
  const { bytes, item } = data(),
    items = [
      item,
      { ...item, version_id: "new-version" },
      { ...item, version_id: "failed-version" },
    ];
  const inventoryBytes = Buffer.from(
    items.map((i) => JSON.stringify(i)).join("\n") + "\n",
  );
  const inventorySummary = {
    complete: true,
    sha256: sha(inventoryBytes),
    cutoff: "2026-10-02T20:19:00.000Z",
    endpoints: { player_battlelog: { versions: 3 } },
  };
  const lines = [],
    requested = [];
  const summary = await mapObservers({
    inventoryBytes,
    inventorySummary,
    read: async (i) => {
      requested.push(i.version_id);
      if (i.version_id === "failed-version") throw Error("missing");
      return bytes;
    },
    write: async (line) => lines.push(line),
  });
  assert.equal(summary.objects, 3);
  assert.equal(summary.failed, 1);
  assert.equal(summary.complete, false);
  assert.equal(lines.map(JSON.parse).filter((i) => i.unresolved).length, 1);
  assert.equal(summary.sha256, sha(Buffer.from(lines.join(""))));
  assert.deepEqual(requested.sort(), [
    "failed-version",
    "new-version",
    "old-version",
  ]);
  await assert.rejects(
    mapObservers({
      inventoryBytes: Buffer.from("altered"),
      inventorySummary,
      read: () => {},
      write: () => {},
    }),
    /altered archive inventory/,
  );
});
