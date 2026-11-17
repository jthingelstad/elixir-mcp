import assert from "node:assert/strict";
import test from "node:test";
import { requestFirstRead } from "../src/live.mjs";

test("an already-read profile still asks for its missing first battle log", async () => {
  const requested = [];
  const db = {
    query: async (_sql, [, endpoint]) => ({
      rows: [{ read: endpoint === "player", failed_status: null, deep: true }],
    }),
  };
  const result = await requestFirstRead(
    db,
    async (_db, { endpoint }) => {
      requested.push(endpoint);
      return { ok: false, reason: "pending", queued: true, minted: true };
    },
    "#00092VJ2",
    "invented-account",
    { battles: true },
  );
  assert.deepEqual(requested, ["player_battlelog"]);
  assert.deepEqual(result.battles, { requested: true, reason: "pending" });
});
