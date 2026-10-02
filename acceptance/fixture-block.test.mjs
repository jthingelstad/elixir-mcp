import test from "node:test";
import assert from "node:assert/strict";
import { gymCases } from "./gym-interp.mjs";

const [criterion] = gymCases([
  {
    id: "900.1",
    feedback: 900,
    control: true,
    tool: "clans_roster",
    args: { clan_tag: "#P0LYQ" },
    needs_fixture: "live clan no longer recorded",
    assert: [{ has: "members[].badge_count" }],
  },
]);
test("a missing live fixture is an explicit block with no network call", async () => {
  const result = await criterion.run({
    read: () => {
      throw new Error("must not read");
    },
  });
  assert.match(result.skip, /BLOCKED.*live clan no longer recorded/);
});
test("a recorded bite executes the same blocked criterion and still catches its missing field", async () => {
  await assert.rejects(
    criterion.run({
      recordedFixtures: true,
      read: async () => ({ body: { members: [{ name: "fixture" }] }, ms: 0 }),
    }),
    /badge_count/,
  );
});
