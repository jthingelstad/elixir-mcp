import test from "node:test";
import assert from "node:assert/strict";
import { inactivityEvidence } from "../src/inactivity.mjs";
import { evaluate } from "../src/evaluate.mjs";
import { member, participation, NOW, EXAMPLE_POLICY } from "./fixture.mjs";

const DAY = 86400_000;
const row = (days, count) => ({
  profile_observed_at: new Date(NOW.getTime() - days * DAY).toISOString(),
  battle_count: count,
});
const subject = () => ({
  ...member("#SYNTHETIC", { lastBattleDaysAgo: 8.02, war: [0, 0, 0, 0, 0, 0] }),
  activity_evidence: {
    current_member: true,
    observations: [
      row(9, 100),
      row(7, 101),
      row(5, 102),
      row(2, 102),
      row(1, 103),
      row(0.25, 103),
    ],
  },
});

test("three uncaptured increments reset the possible-activity bound and hold an eight-day removal", () => {
  const m = subject();
  const proof = inactivityEvidence(m, NOW);
  assert.equal(proof.positive_intervals.length, 3);
  assert.equal(proof.latest_activity_interval.no_battles_captured, true);
  assert.equal(proof.days_since_possible_activity, 1);
  assert.equal(proof.captured_battle_age_days, 8.02);
  assert.equal(proof.unmeasured_tail_hours, 6);
  assert.equal(proof.status, "held");
  const v = evaluate({
    participation: participation([m]),
    policy: EXAMPLE_POLICY,
    now: NOW,
  }).members[0];
  assert.equal(v.judgment.removal, "held");
  assert.equal(v.actionable.removal, false);
});

test("a threshold-straddling increase cannot supply an exact last-play time", () => {
  const m = subject();
  m.activity_evidence.observations = [row(20, 100), row(7, 101), row(0, 101)];
  const proof = inactivityEvidence(m, NOW);
  assert.equal(proof.days_since_possible_activity, 7);
  assert.equal(proof.counter_quiet_days, 7);
  const v = evaluate({
    participation: participation([m]),
    policy: { ...EXAMPLE_POLICY, contribution_grace_max_days: 0 },
    now: NOW,
  }).members[0];
  assert.equal(v.actionable.removal, false);
});

test("complete flat counters covering the threshold can qualify; a tail, short baseline or malformed observation holds", () => {
  const m = member("#SYNTHETIC", {
    lastBattleDaysAgo: 20,
    war: [0, 0, 0, 0, 0, 0],
  });
  const judge = () =>
    evaluate({
      participation: participation([m]),
      policy: EXAMPLE_POLICY,
      now: NOW,
    }).members[0];
  assert.equal(judge().actionable.removal, true);
  for (const observations of [
    [],
    [row(0, 100)],
    [row(7, 100), row(0, 100)],
    [row(20, 100), row(0.1, 100)],
    [row(20, null), row(0, 100)],
    [row(20, 101), row(0, 100)],
    [row(0, 100), row(20, 100)],
    [row(20, 100), { profile_observed_at: "invalid", battle_count: 100 }],
    [row(20, 100), row(-1, 100)],
  ]) {
    m.activity_evidence = { current_member: true, observations };
    assert.equal(
      judge().actionable.removal,
      false,
      JSON.stringify(observations),
    );
    assert.equal(judge().judgment.removal, "held");
  }
  delete m.activity_evidence;
  assert.equal(judge().actionable.removal, false);
});

test("removal triage separates protected roles and recent play from held evidence without permitting removal", () => {
  const judge = (m, options = {}) =>
    evaluate({
      participation: participation([m]),
      policy: EXAMPLE_POLICY,
      now: NOW,
      ...options,
    }).members[0];
  for (const role of ["leader", "coLeader", "elder"]) {
    const m = subject();
    m.role = role;
    const v = judge(m);
    assert.equal(v.removal.triage.status, "protected");
    assert.equal(v.actionable.removal, false);
  }
  const recent = subject();
  recent.last_battle_time = row(0.5, 0).profile_observed_at;
  recent.activity_evidence.observations[0].battle_count = null;
  const captured = judge(recent);
  assert.equal(captured.removal.triage.status, "not_candidate");
  assert.match(captured.removal.triage.reason, /battle was captured/);
  assert.equal(captured.judgment.removal, "held");
  assert.equal(captured.actionable.removal, false);
  const counted = judge(subject());
  assert.equal(counted.removal.triage.status, "not_candidate");
  assert.match(counted.removal.triage.reason, /positive counter bracket/);
  assert.equal(counted.actionable.removal, false);
  const old = member("#SYNTHETIC", {
    lastBattleDaysAgo: 20,
    war: [0, 0, 0, 0, 0, 0],
  });
  old.activity_evidence.observations.at(-1).profile_observed_at = row(
    0.1,
    1,
  ).profile_observed_at;
  assert.equal(judge(old).removal.triage.status, "evidence_held");
  assert.equal(judge(old).actionable.removal, false);
  assert.equal(
    judge(old, { holds: [{ player_tag: old.player_tag, until: null }] }).removal
      .triage.status,
    "protected",
  );
});

test("missing profile days cannot supply counter brackets or quiet time across a gap", () => {
  const m = subject();
  m.activity_evidence.observations = [row(20, 100), row(0, 101)];
  m.activity_evidence.profile_gaps = [
    { snapshot_date: row(2, 0).profile_observed_at.slice(0, 10) },
  ];
  const p = inactivityEvidence(m, NOW);
  assert.equal(p.status, "held");
  assert.match(p.reason, /observations are missing/);
  assert.equal(p.latest_activity_interval, null);
  assert.equal(p.counter_quiet_days, null);
  const v = evaluate({
    participation: participation([m]),
    policy: EXAMPLE_POLICY,
    now: NOW,
  }).members[0];
  assert.equal(v.removal.triage.status, "evidence_held");
  assert.equal(v.actionable.removal, false);
});
