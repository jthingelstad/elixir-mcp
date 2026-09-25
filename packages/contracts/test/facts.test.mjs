import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ATTESTED_FACT_TYPES,
  ATTESTED_FACT_KINDS,
  LEADER_MESSAGE_ROLES,
} from "../dist/index.js";

test("attested facts: a closed registry, each with a subject, a visibility and a typed detail", () => {
  assert.deepEqual(ATTESTED_FACT_KINDS, [
    "departure_classified",
    "role_change_made",
    "award_granted",
    "member_away",
    "clan_message",
    "personal_record",
  ]);
  for (const [kind, t] of Object.entries(ATTESTED_FACT_TYPES)) {
    assert.ok(["clan", "player"].includes(t.subject), kind);
    assert.ok(["clan", "leaders", "player"].includes(t.visibility), kind);
    assert.equal(t.visibility === "player", t.subject === "player", kind);
    for (const [key, f] of Object.entries(t.detail)) {
      assert.ok(["enum", "string", "integer", "instant"].includes(f.type));
      if (f.type === "enum") assert.ok(f.values?.length, `${kind}.${key}`);
      if (f.type === "string") assert.ok(f.max > 0, `${kind}.${key}`);
    }
  }
  // A kick is never narrated: departures and away are leaders' only.
  assert.equal(ATTESTED_FACT_TYPES.departure_classified.visibility, "leaders");
  assert.equal(ATTESTED_FACT_TYPES.member_away.visibility, "leaders");
  assert.deepEqual(LEADER_MESSAGE_ROLES, ["leader", "coLeader"]);
  // Nothing in the registry names a verdict (the naming test).
  assert.doesNotMatch(
    JSON.stringify(ATTESTED_FACT_TYPES),
    /score_?card|verdict|recommend|should|eligible|percentile/i,
  );
});
