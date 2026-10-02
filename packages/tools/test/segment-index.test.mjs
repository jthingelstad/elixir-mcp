import { test } from "node:test";
import assert from "node:assert/strict";
import { segmentFilter } from "../src/tools/shared.mjs";

test("the whole corpus reads the participant's own battle_time: the window index, no join", async () => {
  // 0098: battle_participant_window covers (battle_time) with deck_hash,
  // player_tag and outcome for pvp participants with a deck, so a corpus
  // window scan is index-only; battle is joined only for a mode filter.
  const segment = await segmentFilter({}, { segment: "corpus" }, []);
  assert.equal(segment.timeColumn, "bp.battle_time");
  assert.equal(segment.where, null);
});

test("a retired Collection selector refuses before any population query", async () => {
  await assert.rejects(
    segmentFilter(
      {
        db: {
          query() {
            throw new Error("unexpected database read");
          },
        },
      },
      { segment: { collection: "pros" } },
      [],
    ),
    (error) => error.code === "bad_request",
  );
});
