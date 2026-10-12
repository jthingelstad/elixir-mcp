import test from "node:test";
import assert from "node:assert/strict";
import { inactivityEvidence, removalDay } from "../src/inactivity.mjs";
import { evaluate } from "../src/evaluate.mjs";
import { member, participation, NOW, EXAMPLE_POLICY } from "./fixture.mjs";

const DAY = 86400_000;
const ago = (days) => new Date(NOW.getTime() - days * DAY).toISOString();
const row = (days, count) => ({
  profile_observed_at: ago(days),
  battle_count: count,
});
// No grace: a full roster earns none, so the removal day is the policy's.
const POLICY = { ...EXAMPLE_POLICY, contribution_grace_max_days: 0 };
const judge = (m, options = {}) =>
  evaluate({
    participation: participation([m]),
    policy: POLICY,
    now: NOW,
    ...options,
  }).members[0];
const idle = (days, opts = {}) =>
  member("#SYNTHETIC", {
    lastBattleDaysAgo: days,
    war: [0, 0, 0, 0, 0, 0],
    ...opts,
  });

test("the clock runs from the last recorded battle, and the removal day raises the Action", () => {
  assert.equal(removalDay(POLICY), POLICY.confirm_days);
  for (const [days, state, actionable] of [
    [1, "none", false],
    [POLICY.watch_days, "watch", false],
    [POLICY.at_risk_days, "at_risk", false],
    [POLICY.confirm_days - 0.01, "at_risk", false],
    [POLICY.confirm_days, "recommended", true],
    [30, "recommended", true],
  ]) {
    const v = judge(idle(days));
    assert.equal(v.facts.days_idle, days, `${days}`);
    assert.equal(v.removal.state, state, `${days}`);
    assert.equal(v.judgment.removal, "ready", `${days}`);
    assert.equal(v.actionable.removal, actionable, `${days}`);
  }
  const past = judge(idle(20));
  assert.equal(past.removal.triage.status, "eligible");
  assert.equal(past.removal.removal_day, POLICY.confirm_days);
});

test("the removal day is a day count, never added to at risk, and never before it", () => {
  // Jamie, 2026-10-12: at risk at 7, "10 being the absolute number".
  const policy = { ...POLICY, at_risk_days: 7, confirm_days: 10 };
  assert.equal(removalDay(policy), 10);
  const at = (days) =>
    evaluate({
      participation: participation([idle(days)]),
      policy,
      now: NOW,
    }).members[0];
  assert.equal(at(9.9).actionable.removal, false);
  assert.equal(at(10).actionable.removal, true);
  // A saved day before at risk is read as at risk.
  assert.equal(removalDay({ at_risk_days: 7, confirm_days: 3 }), 7);
  assert.equal(removalDay({ at_risk_days: 7, confirm_days: 3 }, 2), 9);
});

test("a rise in the profile's battle count is play: it moves the clock forward, never back", () => {
  const m = idle(20);
  m.activity_evidence.observations = [row(30, 100), row(6, 100), row(2, 103)];
  const proof = inactivityEvidence(m, NOW);
  assert.equal(proof.status, "ready");
  assert.equal(proof.latest_activity_interval.counter_increase, 3);
  assert.equal(proof.latest_activity_interval.no_battles_captured, true);
  assert.equal(proof.days_since_possible_activity, 2);
  assert.equal(proof.captured_battle_age_days, 20);
  // The reads the card names as the counter it watched (#532).
  assert.equal(proof.counter_reads.reads, 3);
  assert.equal(
    proof.counter_reads.first_read_at,
    m.activity_evidence.observations[0].profile_observed_at,
  );
  assert.equal(
    proof.counter_reads.last_read_at,
    m.activity_evidence.observations[2].profile_observed_at,
  );
  const v = judge(m);
  assert.equal(v.removal.state, "none");
  assert.equal(v.actionable.removal, false);

  // A flat or missing count changes nothing: the battle log decides.
  for (const observations of [
    [],
    [row(0, 100)],
    [row(20, 100), row(0, 100)],
    [row(20, 101), row(0, 100)],
    [row(20, null), row(0, 100)],
    [row(20, 100), { profile_observed_at: "invalid", battle_count: 100 }],
  ]) {
    m.activity_evidence = { current_member: true, observations };
    const w = judge(m);
    assert.equal(w.facts.days_idle, 20, JSON.stringify(observations));
    assert.equal(w.actionable.removal, true, JSON.stringify(observations));
  }
  delete m.activity_evidence;
  assert.equal(judge(m).actionable.removal, true);
});

test("with no battle since joining, the clock runs from the join", () => {
  const m = idle(null, { tenureDays: 12 });
  m.activity_evidence.observations = [];
  const v = judge(m);
  assert.equal(v.facts.days_idle, 12);
  assert.equal(v.actionable.removal, true);
  const newcomer = judge(idle(null, { tenureDays: 2 }));
  assert.equal(newcomer.actionable.removal, false);
  assert.equal(
    newcomer.removal.triage.reason,
    "The member joined inside the getting-quiet window.",
  );
});

test("removal waits only when the clock cannot be read: a failed read, a departed player, an unrecorded log", () => {
  const unavailable = idle(20);
  unavailable.activity_evidence = { unavailable: true, observations: [] };
  const a = judge(unavailable);
  assert.equal(a.judgment.removal, "held");
  assert.equal(a.actionable.removal, false);
  assert.equal(a.removal.triage.status, "evidence_held");
  assert.match(a.removal.triage.reason, /could not read/);

  const gone = idle(20);
  gone.activity_evidence = { current_member: false, observations: [] };
  assert.equal(judge(gone).actionable.removal, false);

  const unrecorded = idle(20);
  unrecorded.log_recorded = false;
  const u = judge(unrecorded);
  assert.equal(u.judgment.removal, "held");
  assert.equal(u.actionable.removal, false);
});

test("protections stand: leaders, elders unless included, holds, and removal turned off", () => {
  for (const role of ["leader", "coLeader", "elder"]) {
    const m = idle(20);
    m.role = role;
    const v = judge(m);
    assert.equal(v.removal.triage.status, "protected", role);
    assert.equal(v.actionable.removal, false, role);
  }
  const elder = idle(20);
  elder.role = "elder";
  assert.equal(
    evaluate({
      participation: participation([elder]),
      policy: { ...POLICY, removal_includes_elders: true },
      now: NOW,
    }).members[0].actionable.removal,
    true,
  );
  const held = idle(20);
  const v = judge(held, {
    holds: [{ player_tag: held.player_tag, until: null }],
  });
  assert.equal(v.removal.triage.status, "protected");
  assert.equal(v.actionable.removal, false);
  assert.equal(
    evaluate({
      participation: participation([idle(20)]),
      policy: { ...POLICY, removal_enabled: false },
      now: NOW,
    }).members[0].actionable.removal,
    false,
  );
});

test("a battle inside the getting-quiet window says so", () => {
  const v = judge(idle(1));
  assert.equal(v.removal.triage.status, "not_candidate");
  assert.equal(
    v.removal.triage.reason,
    "A battle was recorded inside the getting-quiet window.",
  );
});
