import test from "node:test";
import assert from "node:assert/strict";
import {
  battleCapture,
  hasBattleEvidence,
  membershipCapture,
} from "../src/capture-state.mjs";

const from = "2026-10-05T05:00:00Z",
  to = "2026-10-06T05:00:00Z";
const interval = (
  start = "2026-10-05T04:00:00Z",
  end = to,
  overrides = {},
) => ({
  observed_from: start,
  observed_to: end,
  expected_battles: 0,
  captured_battles: 0,
  is_complete: true,
  ...overrides,
});

for (const [name, intervals] of [
  ["never observed", []],
  ["failed poll", []],
  [
    "stale interval outside the day",
    [interval("2026-10-03T00:00:00Z", "2026-10-04T00:00:00Z")],
  ],
  ["one successful current poll is not an interval", [{ observed_to: to }]],
  [
    "incomplete capture",
    [
      interval(undefined, undefined, {
        is_complete: false,
        expected_battles: 5,
      }),
    ],
  ],
  [
    "incomparable counter",
    [
      interval(undefined, undefined, {
        is_complete: null,
        expected_battles: null,
      }),
    ],
  ],
  [
    "a full ratio without matching counts",
    [
      interval(undefined, undefined, {
        expected_battles: 5,
        captured_battles: 4,
        ratio: 1,
      }),
    ],
  ],
  ["an unbracketed tail", [interval(undefined, "2026-10-06T04:59:00Z")]],
  [
    "a gap between complete intervals",
    [
      interval(undefined, "2026-10-05T12:00:00Z"),
      interval("2026-10-05T12:01:00Z"),
    ],
  ],
  ["the exclusive start boundary", [interval(from)]],
  ["a malformed interval alongside a complete interval", [interval(), null]],
  [
    "an unknown overlap alongside a complete interval",
    [interval(), interval("2026-10-05T12:00:00Z", to, { is_complete: null })],
  ],
]) {
  test(`capture: ${name} cannot establish a quiet day`, () => {
    const empty = battleCapture({ from, to, intervals });
    assert.equal(empty.quiet, false);
    assert.notEqual(empty.coverage, "complete");
    const positive = battleCapture({ from, to, intervals, recordedBattles: 2 });
    assert.equal(positive.has_battles, true);
    assert.equal(positive.quiet, false);
  });
}

test("capture: only whole-window comparable coverage supports a zero; positive rows always win", () => {
  const intervals = [
    interval(undefined, "2026-10-05T12:00:00Z"),
    interval("2026-10-05T12:00:00Z"),
  ];
  assert.deepEqual(battleCapture({ from, to, intervals }), {
    coverage: "complete",
    has_battles: false,
    quiet: true,
  });
  assert.deepEqual(battleCapture({ from, to, intervals, recordedBattles: 3 }), {
    coverage: "complete",
    has_battles: true,
    quiet: false,
  });
  assert.equal(
    battleCapture({ from, to, intervals, readComplete: false }).quiet,
    false,
  );
});

test("capture: positive first-record evidence survives missing profile or current coverage", () => {
  assert.equal(hasBattleEvidence({ battles_30d: 2 }), true);
  assert.equal(
    hasBattleEvidence({
      battles_30d: 0,
      last_battle_at: "2026-07-01T12:00:00Z",
    }),
    true,
  );
  assert.equal(
    hasBattleEvidence({ battles_30d: 0, last_battle_at: "unknown" }),
    false,
  );
  assert.equal(hasBattleEvidence(null), false);
});

test("membership: absence requires an explicit observed profile; old observations stay dated facts", () => {
  for (const observation of [
    null,
    {},
    { state: "none" },
    { state: "none", observed_at: "invalid" },
    { state: "unknown", observed_at: from },
    { state: "none", observed_at: "2099-01-01T00:00:00Z" },
  ])
    assert.deepEqual(membershipCapture(observation), {
      state: "unknown",
      observed_at: null,
    });
  for (const state of ["none", "member"])
    assert.deepEqual(membershipCapture({ state, observed_at: from }), {
      state,
      observed_at: "2026-10-05T05:00:00.000Z",
    });
});
