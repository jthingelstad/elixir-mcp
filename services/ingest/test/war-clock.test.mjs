import { test } from "node:test";
import assert from "node:assert/strict";
import {
  periodInfo,
  inferSeasonId,
  warClock,
  resolveWarKeys,
  nominalPeriodStartMs,
  nominalPeriodBoundsMs,
  seasonFromDate,
} from "../src/war-clock.mjs";
import { fixture } from "./helpers.mjs";

test("period grid: the three REAL captured payloads sit where the math says", async () => {
  // warDay periodIndex 27 / section 3 -> day 6 of section -> warDay 4
  const war = await fixture("currentriverrace/war_day.json");
  assert.equal(Math.floor(war.periodIndex / 7), war.sectionIndex);
  assert.deepEqual(periodInfo(war.periodIndex), {
    sectionIndex: 3,
    dayInSection: 6,
    kind: "war",
    warDay: 4,
  });
  // training periodIndex 30 / section 4 -> day 2 -> training, no warDay
  const training = await fixture("currentriverrace/training.json");
  assert.equal(periodInfo(training.periodIndex).kind, "training");
  assert.equal(periodInfo(training.periodIndex).warDay, null);
  // colosseum periodIndex 31 / section 4 -> day 3 -> first battle day
  const col = await fixture("currentriverrace/colosseum.json");
  assert.deepEqual(periodInfo(col.periodIndex), {
    sectionIndex: 4,
    dayInSection: 3,
    kind: "war",
    warDay: 1,
  });
});

test("season inference: live wins, then the calendar; logged is last resort", () => {
  assert.equal(inferSeasonId(136, null), 136);
  // The calendar decides when a timestamp is available — regardless of
  // logged state (the phantom-season incident: stateful roll inference
  // ran away under out-of-order replay).
  assert.equal(
    inferSeasonId(
      undefined,
      { seasonId: 145, sectionIndex: 4, liveSectionIndex: 0 },
      Date.UTC(2026, 7, 20),
    ),
    135,
  );
  assert.equal(
    inferSeasonId(undefined, { seasonId: 135, sectionIndex: 4 }),
    135,
  );
  assert.equal(inferSeasonId(undefined, null), null);
});

test("clock: the POLICY grid sets the boundary; the anchor picks the day", async () => {
  // Jamie, 2026-09-07: Elixir MCP is multi-clan and cannot honour every
  // clan's matchmaking drift, so a war day is the policy 10:00Z day for
  // every clan. The anchor still says WHICH day, and is reported raw.
  const col = await fixture("currentriverrace/colosseum.json");
  const anchor = Date.parse("2026-09-03T09:37:00Z"); // drifted EARLY
  const now = Date.parse("2026-09-03T14:40:34Z");
  const anchored = warClock(col, { nowMs: now, anchorMs: anchor });
  assert.equal(anchored.anchored, true);
  assert.equal(
    anchored.periodStartMs,
    Date.parse("2026-09-03T10:00:00Z"),
    "the boundary is the policy hour, not the observed start",
  );
  assert.equal(
    anchored.periodEndMs,
    Date.parse("2026-09-04T10:00:00Z"),
    "a policy day is exactly one day long",
  );
  assert.equal(
    anchored.observedStartMs,
    anchor,
    "the raw observation is kept so a single-clan consumer can correct",
  );
  assert.equal(
    anchored.kind,
    "colosseum",
    "payload periodType wins for display",
  );
  assert.equal(anchored.warDay, 1, "the %7 grid decides numbering");

  // Two clans whose races opened 100 minutes apart still share one
  // window - the whole point of following policy.
  const other = warClock(col, {
    nowMs: now,
    anchorMs: Date.parse("2026-09-03T11:17:00Z"),
  });
  assert.equal(other.periodStartMs, anchored.periodStartMs);
  assert.equal(other.periodEndMs, anchored.periodEndMs);

  const stale = warClock(col, { nowMs: now, anchorMs: anchor - 3 * 86400_000 });
  assert.equal(stale.anchored, false);
  assert.equal(
    stale.periodStartMs,
    nominalPeriodStartMs(now),
    "stale anchor falls back to the grid at now, never goes negative",
  );
  assert.equal(stale.observedStartMs, anchor - 3 * 86400_000);
});

test("clock rejects a periodIndex outside its sectionIndex", async () => {
  const war = await fixture("currentriverrace/war_day.json");
  assert.throws(() =>
    warClock(
      { ...war, sectionIndex: war.sectionIndex + 1 },
      { nowMs: Date.now() },
    ),
  );
});

test("war keys come from the battle time, walking whole war-dates back", async () => {
  const war = await fixture("currentriverrace/war_day.json"); // p27, warDay 4
  const anchor = Date.parse("2026-08-30T09:40:00Z");
  const clock = warClock(war, {
    nowMs: Date.parse("2026-08-30T12:00:00Z"),
    anchorMs: anchor,
    logged: { seasonId: 135, sectionIndex: 3 },
  });

  // In the current period.
  assert.deepEqual(resolveWarKeys(Date.parse("2026-08-30T11:00:00Z"), clock), {
    seasonId: 135,
    sectionIndex: 3,
    warDay: 4,
  });
  // 30h before the anchor -> two war-dates back -> warDay 2.
  assert.deepEqual(resolveWarKeys(anchor - 30 * 3600_000, clock), {
    seasonId: 135,
    sectionIndex: 3,
    warDay: 2,
  });
  // 3.5 days back lands on a training day -> section keys, no war day.
  const training = resolveWarKeys(anchor - 3.5 * 86400_000, clock);
  assert.equal(training.sectionIndex, 3);
  assert.equal(training.warDay, null);
  // A week back crosses into the previous section -> honest nulls.
  assert.deepEqual(resolveWarKeys(anchor - 7 * 86400_000, clock), {
    seasonId: null,
    sectionIndex: null,
    warDay: null,
  });
});

test("season calendar: stateless derivation matches the riverracelog record", () => {
  // S134 = Jul 6 -> Aug 3 (log weeks finished Jul 13/20/27, Aug 3).
  assert.deepEqual(
    (({ seasonId, sectionIndex }) => ({ seasonId, sectionIndex }))(
      seasonFromDate(Date.UTC(2026, 6, 12, 12)),
    ),
    { seasonId: 134, sectionIndex: 0 },
  );
  assert.equal(seasonFromDate(Date.UTC(2026, 6, 30, 12)).seasonId, 134);
  assert.equal(seasonFromDate(Date.UTC(2026, 6, 30, 12)).sectionIndex, 3);
  // S135 = Aug 3 -> Sep 7; TODAY (Sep 4) is S135's colosseum week.
  assert.deepEqual(
    (({ seasonId, sectionIndex }) => ({ seasonId, sectionIndex }))(
      seasonFromDate(Date.UTC(2026, 8, 4, 12)),
    ),
    { seasonId: 135, sectionIndex: 4 },
  );
  // Sep 7 09:31Z rolls to S136 section 0.
  assert.equal(seasonFromDate(Date.UTC(2026, 8, 7, 9, 31)).seasonId, 136);
  // Out-of-order robustness: an archive instant derives the same season
  // no matter what any logged state says.
  assert.equal(
    inferSeasonId(
      null,
      { seasonId: 145, sectionIndex: 4 },
      Date.UTC(2026, 6, 15),
    ),
    134,
  );
});

test("nominalPeriodBoundsMs snaps to the policy grid through early drift", () => {
  // The 10:00Z reset is policy; clans are matched into races of five as
  // matchmaking fills, so a clan's real start drifts off the hour and
  // our anchor adds polling latency on top. Every case below must land
  // on the SAME policy day, which is what makes a war day mean the same
  // 24 hours for every clan.
  const day = (h, m = 0) => Date.UTC(2026, 8, 6, h, m);
  const expect = {
    startMs: Date.UTC(2026, 8, 6, 10),
    endMs: Date.UTC(2026, 8, 7, 10),
  };
  // Observed three minutes BEFORE the hour (the reset ran early). The
  // old "next 10:00Z after the anchor" made this period 3 minutes long.
  assert.deepEqual(nominalPeriodBoundsMs(day(9, 57)), expect);
  assert.deepEqual(nominalPeriodBoundsMs(day(10, 0)), expect);
  assert.deepEqual(nominalPeriodBoundsMs(day(10, 5)), expect);
  // Observed hours late because polling was sparse - still the same day.
  assert.deepEqual(nominalPeriodBoundsMs(day(20, 55)), expect);
  assert.deepEqual(nominalPeriodBoundsMs(day(23, 59)), expect);
  // Well before the hour belongs to the PREVIOUS policy day.
  assert.deepEqual(nominalPeriodBoundsMs(day(3, 41)), {
    startMs: Date.UTC(2026, 8, 5, 10),
    endMs: Date.UTC(2026, 8, 6, 10),
  });
  // A period is always exactly one day long, never negative or zero.
  for (let h = 0; h < 24; h += 1) {
    const b = nominalPeriodBoundsMs(day(h, 30));
    assert.equal(b.endMs - b.startMs, 24 * 3600_000);
    assert.ok(b.endMs > day(h, 30), `period ending after the anchor at ${h}h`);
  }
});
