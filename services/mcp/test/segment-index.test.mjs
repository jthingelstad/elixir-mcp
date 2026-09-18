import { test } from "node:test";
import assert from "node:assert/strict";
import { segmentFilter } from "../src/tools/shared.mjs";

test("collection segments select the participant-time access path", async () => {
  const params = [];
  const ctx = {
    account: { accountId: "account-1" },
    db: {
      async query(_sql, values) {
        assert.deepEqual(values, ["pros", "account-1"]);
        return { rows: [{ collection_id: 42 }] };
      },
    },
  };

  const segment = await segmentFilter(
    ctx,
    { segment: { collection: " Pros " } },
    params,
  );

  assert.equal(segment.timeColumn, "bp.battle_time");
  assert.deepEqual(params, [42]);
  assert.match(segment.where, /collection_member/);
  assert.deepEqual(segment.echo, { kind: "collection", collection: "pros" });
});

test("the whole corpus reads the participant's own battle_time: the window index, no join", async () => {
  // 0098: battle_participant_window covers (battle_time) with deck_hash,
  // player_tag and outcome for pvp participants with a deck, so a corpus
  // window scan is index-only; battle is joined only for a mode filter.
  const segment = await segmentFilter({}, { segment: "corpus" }, []);
  assert.equal(segment.timeColumn, "bp.battle_time");
  assert.equal(segment.where, null);
});
