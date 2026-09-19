import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BUCKETS,
  bucketOf,
  normalize,
  massBetween,
  expectedBattles,
  peakMassBetween,
  nextDueMs,
  fleetMass,
} from "../src/rhythm.mjs";

const HOUR = 3600_000;
// Monday 2026-09-14 00:00Z: bucket 0.
const MONDAY = Date.UTC(2026, 8, 14, 0, 0, 0);

/** A rhythm with all its mass in the given (bucket -> weight) map. */
function rhythm(weights) {
  const r = new Array(BUCKETS).fill(0);
  for (const [b, w] of Object.entries(weights)) r[Number(b)] = w;
  return r;
}

test("buckets are (isodow - 1) * 24 + UTC hour, Monday 00:00Z first", () => {
  assert.equal(bucketOf(MONDAY), 0);
  assert.equal(bucketOf(MONDAY + 23 * HOUR), 23);
  assert.equal(bucketOf(MONDAY + 24 * HOUR), 24); // Tuesday 00Z
  assert.equal(bucketOf(MONDAY - HOUR), 167); // Sunday 23Z
});

test("normalize gives unit mass and refuses an empty or malformed rhythm", () => {
  const m = normalize(rhythm({ 0: 3, 1: 1 }));
  assert.equal(m[0], 0.75);
  assert.equal(m[1], 0.25);
  assert.equal(normalize(new Array(BUCKETS).fill(0)), null);
  assert.equal(normalize([1, 2, 3]), null);
  assert.equal(normalize(null), null);
});

test("mass and expected battles integrate the hours an interval touches, fractionally", () => {
  // Evenings 19-21Z on Monday, 10 battles a week.
  const m = normalize(rhythm({ 19: 1, 20: 1, 21: 1 }));
  const from = MONDAY + 18 * HOUR;
  assert.equal(massBetween(m, from, MONDAY + 19 * HOUR), 0); // 18-19: quiet
  assert.ok(Math.abs(massBetween(m, from, MONDAY + 20 * HOUR) - 1 / 3) < 1e-9);
  assert.ok(
    Math.abs(massBetween(m, from, MONDAY + 19.5 * HOUR) - 1 / 6) < 1e-9,
  ); // half of 19Z
  assert.ok(Math.abs(massBetween(m, from, MONDAY + 22 * HOUR) - 1) < 1e-9);
  assert.ok(
    Math.abs(expectedBattles(m, 10, from, MONDAY + 20 * HOUR) - 10 / 3) < 1e-9,
  );
  // A whole week plus a bit counts one full week plus the remainder.
  assert.equal(
    Math.round(massBetween(m, from, from + 7 * 24 * HOUR + 2 * HOUR) * 1000),
    Math.round((1 + 1 / 3) * 1000),
  );
  assert.equal(massBetween(m, from, from), 0);
});

test("peak mass is the largest hourly share the wait crossed, even partially", () => {
  const m = normalize(rhythm({ 19: 3, 20: 1 }));
  assert.equal(peakMassBetween(m, MONDAY, MONDAY + 18 * HOUR), 0);
  assert.equal(peakMassBetween(m, MONDAY, MONDAY + 19.1 * HOUR), 0.75);
  assert.equal(
    peakMassBetween(m, MONDAY + 20 * HOUR, MONDAY + 21 * HOUR),
    0.25,
  );
  assert.equal(peakMassBetween(m, MONDAY, MONDAY + 8 * 24 * HOUR), 0.75);
});

test("the next due time is where the expected count crosses the target, inside the bounds", () => {
  const bounds = { floorMs: 15 * 60_000, ceilingMs: 1440 * 60_000 };
  // 20 battles a week, all of them Monday 19-21Z: 10 an hour there.
  const m = normalize(rhythm({ 19: 1, 20: 1 }));
  // From Monday 18Z, five battles are expected half an hour into 19Z.
  assert.equal(
    nextDueMs(m, 20, MONDAY + 18 * HOUR, 5, bounds),
    MONDAY + 19.5 * HOUR,
  );
  // From 19Z exactly the crossing is at 19:30 too; the floor is 15 min.
  assert.equal(
    nextDueMs(m, 20, MONDAY + 19 * HOUR, 5, bounds),
    MONDAY + 19.5 * HOUR,
  );
  // From 19:29 the crossing (19:59) stands: the floor only lifts.
  const at = MONDAY + 19 * HOUR + 29 * 60_000;
  assert.equal(nextDueMs(m, 20, at, 5, bounds), at + 30 * 60_000);
  // A target reached faster than the floor waits for the floor.
  assert.equal(
    nextDueMs(m, 2000, MONDAY + 19 * HOUR, 5, bounds),
    MONDAY + 19 * HOUR + bounds.floorMs,
  );
  // From Monday 22Z nothing is expected until next Monday: the ceiling.
  assert.equal(
    nextDueMs(m, 20, MONDAY + 22 * HOUR, 5, bounds),
    MONDAY + 22 * HOUR + bounds.ceilingMs,
  );
  // No weekly rate at all is the ceiling too, never longer.
  assert.equal(nextDueMs(m, 0, MONDAY, 5, bounds), MONDAY + bounds.ceilingMs);
});

test("the fleet rhythm weighs each player once", () => {
  const grinder = rhythm({ 0: 1000 });
  const casual = rhythm({ 100: 1 });
  const f = fleetMass([grinder, casual, new Array(BUCKETS).fill(0)]);
  assert.equal(f[0], 0.5);
  assert.equal(f[100], 0.5);
  assert.equal(fleetMass([new Array(BUCKETS).fill(0)]), null);
});
