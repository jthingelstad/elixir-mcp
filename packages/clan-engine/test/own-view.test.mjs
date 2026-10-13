import { test } from "node:test";
import assert from "node:assert/strict";
import {
  actionsWaitingFor,
  effectivePolicyValues,
  ownStandingLine,
  policySummaryOf,
} from "../src/own-view.mjs";
import { evaluate } from "../src/evaluate.mjs";
import { defaults, MIN_MEMBERS, RETIRED_FIELDS } from "../src/policy.mjs";
import { member, participation, NOW, EXAMPLE_POLICY } from "./fixture.mjs";

const verdictsWithIdle = () =>
  evaluate({
    participation: participation([
      ...Array.from({ length: 9 }, (_, i) => member(`#O${i}`)),
      member("#ME", { tenureDays: 10 }),
      member("#IDLE", { lastBattleDaysAgo: 9, war: [0, 0, 0, 0, 0, 0] }),
    ]),
    policy: EXAMPLE_POLICY,
    now: NOW,
    policy_version: 3,
  });

test("a saved version runs with today's fields: new ones default, retired ones drop", () => {
  const values = effectivePolicyValues({
    [RETIRED_FIELDS[0]]: true,
    removal_enabled: true,
  });
  assert.ok(!(RETIRED_FIELDS[0] in values));
  assert.equal(values.removal_enabled, true);
  assert.deepEqual(effectivePolicyValues(null), effectivePolicyValues({}));
  assert.deepEqual(
    Object.keys(effectivePolicyValues(null)).sort(),
    Object.keys(defaults())
      .filter((k) => !RETIRED_FIELDS.includes(k))
      .sort(),
  );
});

test("the policy summary is inactive, every switch off, below the minimum", () => {
  const values = effectivePolicyValues(EXAMPLE_POLICY);
  const small = policySummaryOf({
    set: true,
    version: 2,
    values,
    members: MIN_MEMBERS - 1,
  });
  assert.equal(small.active, false);
  assert.equal(small.removal, false);
  assert.equal(small.away, false);
  assert.equal(small.ranks_elder, false);
  const unknown = policySummaryOf({
    set: true,
    version: 2,
    values,
    members: null,
  });
  assert.equal(unknown.active, true, "an unknown size does not pause it");
  assert.equal(unknown.removal, true);
  assert.equal(unknown.away, true);
});

test("the standing line is the person's own, and a removal shows as at risk", () => {
  const verdicts = verdictsWithIdle();
  const values = effectivePolicyValues(EXAMPLE_POLICY);
  const idle = ownStandingLine({
    verdicts,
    playerTag: "#IDLE",
    values,
    version: 3,
  });
  assert.equal(
    verdicts.members.find((m) => m.player_tag === "#IDLE").removal.state,
    "recommended",
  );
  assert.equal(idle.inactivity.state, "at_risk");
  assert.equal(idle.version, 3);
  const mine = ownStandingLine({
    verdicts,
    playerTag: "#ME",
    values,
    version: 3,
  });
  const text = JSON.stringify(mine);
  for (const other of ["#IDLE", "#O0", "IDLE"])
    assert.ok(!text.includes(other), `no ${other} in the person's own line`);
  assert.equal(
    ownStandingLine({ verdicts, playerTag: "#NOBODY", values, version: 3 }),
    null,
  );
});

const cards = [
  {
    card_id: "r",
    type: "removal",
    player_tag: "#IDLE",
    player_name: "Idle One",
    status: "proposed",
    number: 1,
    raised_at: "2026-09-12T10:00:00Z",
  },
  {
    card_id: "p",
    type: "promotion",
    player_tag: "#O1",
    player_name: "Rising One",
    status: "proposed",
    number: 2,
    raised_at: "2026-09-11T10:00:00Z",
  },
  {
    card_id: "w",
    type: "welcome",
    player_tag: "#O2",
    player_name: "New One",
    status: "proposed",
    raised_at: "2026-09-10T10:00:00Z",
  },
  {
    card_id: "a",
    type: "away",
    player_tag: "#ME",
    player_name: "Me",
    status: "proposed",
    number: 4,
    raised_at: "2026-09-09T10:00:00Z",
  },
  {
    card_id: "a2",
    type: "away",
    player_tag: "#IDLE",
    player_name: "Idle One",
    status: "proposed",
    number: 5,
    raised_at: "2026-09-08T10:00:00Z",
  },
  {
    card_id: "done",
    type: "promotion",
    player_tag: "#O3",
    status: "done",
    number: 6,
    raised_at: "2026-09-13T10:00:00Z",
  },
];

test("a member sees only their own Action waiting, never another's or a removal", () => {
  const waiting = actionsWaitingFor(cards, {
    player_tag: "#ME",
    role: "member",
  });
  assert.deepEqual(
    waiting.map((a) => a.type),
    ["away"],
  );
  assert.deepEqual(Object.keys(waiting[0]).sort(), [
    "label",
    "number",
    "raised_at",
    "subject_name",
    "type",
  ]);
  // The subject of a removal Action never sees it either.
  assert.deepEqual(
    actionsWaitingFor(cards, { player_tag: "#IDLE", role: "member" }).map(
      (a) => a.type,
    ),
    ["away"],
  );
});

test("a leader who would decide a removal is never shown one; an unnumbered Action has number null", () => {
  for (const role of ["leader", "coLeader"]) {
    const waiting = actionsWaitingFor(cards, { player_tag: "#L", role });
    assert.deepEqual(
      waiting.map((a) => a.type),
      ["promotion", "welcome"],
      "newest first, no removal, no closed Action",
    );
    assert.equal(waiting[1].number, null);
    assert.ok(!JSON.stringify(waiting).includes("Idle One"));
  }
  assert.deepEqual(
    actionsWaitingFor(cards, { player_tag: "#E", role: "elder" }).map(
      (a) => a.type,
    ),
    ["welcome"],
  );
});
