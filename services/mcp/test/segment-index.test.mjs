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

test("the whole corpus keeps the battle-time access path", async () => {
  const segment = await segmentFilter({}, {}, []);
  assert.equal(segment.timeColumn, "b.battle_time");
  assert.equal(segment.where, null);
});
