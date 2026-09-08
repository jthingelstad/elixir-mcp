/**
 * Cohorts must not stay in lockstep.
 *
 * Observed live 2026-09-08: capture arrived as three spikes at 23:00, 07:00
 * and 15:00 UTC -- exactly 8h apart, each 3.4x the hourly baseline. Every
 * cadence in plan.mjs is a pure function of a subject's state and due-ness is
 * `now - reference >= cadence`, so subjects seeded together in the same state
 * are due together forever. Adding a batch of clans enrolls their members as
 * one such cohort.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { jitterFactor, JITTER_SPREAD } from "../src/plan.mjs";

const TAGS = Array.from(
  { length: 400 },
  (_, i) => `#TAG${i.toString(36).toUpperCase()}`,
);

test("the factor is stable: same subject, same answer, always", () => {
  // Re-rolling per tick would leave a cohort clustered on average and only
  // add noise -- and this file's deterministic tie-break needs reproducible
  // planning.
  for (const tag of TAGS.slice(0, 20))
    assert.equal(
      jitterFactor(tag, "player"),
      jitterFactor(tag, "player"),
      `${tag} must hash identically every call`,
    );
});

test("the same subject jitters differently per endpoint", () => {
  // A player's profile and battlelog should not spike together either.
  let differing = 0;
  for (const tag of TAGS)
    if (jitterFactor(tag, "player") !== jitterFactor(tag, "player_battlelog"))
      differing += 1;
  assert.equal(differing, TAGS.length);
});

test("factors stay inside the declared spread", () => {
  for (const tag of TAGS) {
    const f = jitterFactor(tag, "player");
    assert.ok(
      f >= 1 - JITTER_SPREAD / 2 && f <= 1 + JITTER_SPREAD / 2,
      `${tag}: ${f} outside +/-${(JITTER_SPREAD / 2) * 100}%`,
    );
  }
});

test("a cohort spreads across the whole window, not just near the middle", () => {
  // The property that actually matters: bucket 400 subjects by where their
  // next poll lands in an 8h cadence and require every part of the window to
  // carry real load. A hash that clumped would pass a min/max check and still
  // reproduce the spike.
  const CADENCE_MIN = 480;
  const buckets = new Array(8).fill(0);
  for (const tag of TAGS) {
    const due = CADENCE_MIN * jitterFactor(tag, "player");
    const spreadMin = CADENCE_MIN * JITTER_SPREAD;
    const offset = due - CADENCE_MIN * (1 - JITTER_SPREAD / 2);
    buckets[Math.min(7, Math.floor((offset / spreadMin) * 8))] += 1;
  }
  const expected = TAGS.length / 8;
  for (const [i, n] of buckets.entries())
    assert.ok(
      n > expected * 0.5,
      `bucket ${i} holds ${n} of ${TAGS.length}; distribution is clumped: ${buckets}`,
    );
});

test("a cohort de-phases progressively, not just once", () => {
  // Multiplicative, so the extremes separate a little further every cycle.
  // After a few polls the cohort is genuinely spread rather than smeared.
  const CADENCE = 480;
  const lo = Math.min(...TAGS.map((t) => jitterFactor(t, "player")));
  const hi = Math.max(...TAGS.map((t) => jitterFactor(t, "player")));
  // At +/-15% the extremes separate by 0.3 x cadence per poll, so full
  // de-phasing takes ceil(1 / 0.3) = 4 cycles -- about 32h on the 8h profile
  // cadence that produced the observed spikes. Pinned because widening or
  // narrowing JITTER_SPREAD changes how long a new cohort stays visible.
  const cycles = 4;
  const separation = cycles * CADENCE * (hi - lo);
  assert.ok(
    separation >= CADENCE,
    `after ${cycles} cycles the extremes are ${Math.round(separation)}min ` +
      `apart; needs to exceed one ${CADENCE}min cadence`,
  );
});

/**
 * The profile cadence has to read activity from where activity is recorded.
 *
 * ingest writes yield_bph to the player_battlelog row and nowhere else, so
 * the 'player' row's own column is NULL forever. Every branch below the first
 * was therefore unreachable and dormant profiles polled every 8h instead of
 * every 72h -- about 9x the intended rate, in lockstep.
 */
import { yieldCadenceMinutes } from "../src/plan.mjs";

test("a dormant player's profile stretches instead of polling every 8h", () => {
  const dormant = { endpoint: "player", yield_bph: null, activity_bph: 0 };
  assert.equal(yieldCadenceMinutes(dormant), 4320);
});

test("an active player's profile tightens", () => {
  assert.equal(
    yieldCadenceMinutes({
      endpoint: "player",
      yield_bph: null,
      activity_bph: 2,
    }),
    120,
  );
  assert.equal(
    yieldCadenceMinutes({
      endpoint: "player",
      yield_bph: null,
      activity_bph: 0.1,
    }),
    1440,
  );
});

test("a genuinely unknown player still starts at the discovery cadence", () => {
  // No battlelog row yet: 480m is discovery, not dormancy, and must survive.
  assert.equal(
    yieldCadenceMinutes({
      endpoint: "player",
      yield_bph: null,
      activity_bph: null,
    }),
    480,
  );
});
