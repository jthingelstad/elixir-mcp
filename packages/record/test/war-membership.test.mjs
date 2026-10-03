import test from "node:test";
import assert from "node:assert/strict";
import {
  absentAtWarWeeks,
  warMembershipEvidence,
} from "../src/war-membership.mjs";

const participation = () => ({
  recording_active_since: "2026-08-01T00:00:00Z",
  first_roster_observed_at: "2026-08-01T00:00:00Z",
  members: [{ player_tag: "#RETURN" }],
  war_weeks: [
    {
      started_observed_at: "2026-09-07T10:00:00Z",
      finished_observed_at: "2026-09-14T10:00:00Z",
    },
  ],
});
const intervals = () => [
  {
    player_tag: "#RETURN",
    joined_observed_at: "2026-08-05T00:00:00Z",
    left_observed_at: "2026-09-06T13:00:00Z",
  },
  {
    player_tag: "#RETURN",
    joined_observed_at: "2026-09-29T12:00:00Z",
    left_observed_at: null,
  },
];
const boundaries = () => [
  {
    i: 1,
    before_start: "2026-09-07T09:55:00Z",
    after_finish: "2026-09-14T10:05:00Z",
  },
];

test("recorded absence covers the whole bracketed week, not merely the finish or current stint", () => {
  const base = {
    participation: participation(),
    memberships: intervals(),
    boundaries: boundaries(),
  };
  assert.deepEqual(absentAtWarWeeks(base)["#RETURN"], [true]);
  for (const interval of [
    {
      player_tag: "#RETURN",
      joined_observed_at: "2026-09-08T00:00:00Z",
      left_observed_at: "2026-09-09T00:00:00Z",
    },
    {
      player_tag: "#RETURN",
      joined_observed_at: "2026-09-07T09:58:00Z",
      left_observed_at: null,
    },
  ])
    assert.deepEqual(
      absentAtWarWeeks({ ...base, memberships: [...intervals(), interval] })[
        "#RETURN"
      ],
      [false],
    );
});

test("missing bracketing reads, invalid intervals, no membership rows or late recording keep absence unknown", () => {
  const base = {
    participation: participation(),
    memberships: intervals(),
    boundaries: boundaries(),
  };
  for (const patch of [
    { boundaries: [] },
    { memberships: [] },
    { boundaries: [{ ...boundaries()[0], before_start: null }] },
    { boundaries: [{ ...boundaries()[0], after_finish: null }] },
    {
      memberships: [
        { ...intervals()[0], left_observed_at: "2026-08-04T00:00:00Z" },
      ],
    },
    {
      participation: {
        ...participation(),
        recording_active_since: "2026-09-08T00:00:00Z",
      },
    },
  ])
    assert.deepEqual(absentAtWarWeeks({ ...base, ...patch })["#RETURN"], [
      null,
    ]);
});

test("internal membership read uses the shared canonical query and never writes", async () => {
  const queries = [];
  const db = {
    query: async (text, values) => {
      queries.push({ text, values });
      return { rows: queries.length === 1 ? intervals() : boundaries() };
    },
  };
  assert.deepEqual(await warMembershipEvidence(db, "#CLAN", participation()), {
    war: { "#RETURN": [true] },
    donations: { "#RETURN": [] },
  });
  assert.equal(queries.length, 2);
  assert.match(queries[0].text, /from clan_membership/);
  assert.match(queries[1].text, /api_receipt/);
  assert.ok(queries.every((q) => !/(insert|update|delete)\s/i.test(q.text)));
  assert.equal(queries[0].values[0], "#CLAN");
});

test("donation absence uses the full game-day week separately from the observed race", async () => {
  const p = participation();
  p.weeks = [{ from: "2026-09-07T00:00:00Z", to: "2026-09-14T00:00:00Z" }];
  p.war_weeks[0].started_observed_at = "2026-09-09T10:00:00Z";
  const history = intervals();
  history[0].left_observed_at = "2026-09-08T13:00:00Z";
  const queries = [];
  const db = {
    query: async (text, values) => {
      queries.push({ text, values });
      return {
        rows:
          queries.length === 1
            ? history
            : [
                { ...boundaries()[0], before_start: "2026-09-09T09:55:00Z" },
                { ...boundaries()[0], i: 2 },
              ],
      };
    },
  };
  const evidence = await warMembershipEvidence(db, "#CLAN", p);
  assert.deepEqual(evidence.war["#RETURN"], [true]);
  assert.deepEqual(evidence.donations["#RETURN"], [false]);
  assert.equal(queries[1].values[1][1], "2026-09-07T10:00:00.000Z");
  assert.equal(queries[1].values[2][1], "2026-09-14T10:00:00.000Z");
});
