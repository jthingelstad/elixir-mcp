import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  periodInfo,
  inferSeasonId,
  warClock,
  resolveWarKeys,
  nominalPeriodStartMs,
} from '../src/war-clock.mjs';
import { fixture } from './helpers.mjs';

test('period grid: the three REAL captured payloads sit where the math says', async () => {
  // warDay periodIndex 27 / section 3 -> day 6 of section -> warDay 4
  const war = await fixture('currentriverrace/war_day.json');
  assert.equal(Math.floor(war.periodIndex / 7), war.sectionIndex);
  assert.deepEqual(periodInfo(war.periodIndex), {
    sectionIndex: 3,
    dayInSection: 6,
    kind: 'war',
    warDay: 4,
  });
  // training periodIndex 30 / section 4 -> day 2 -> training, no warDay
  const training = await fixture('currentriverrace/training.json');
  assert.equal(periodInfo(training.periodIndex).kind, 'training');
  assert.equal(periodInfo(training.periodIndex).warDay, null);
  // colosseum periodIndex 31 / section 4 -> day 3 -> first battle day
  const col = await fixture('currentriverrace/colosseum.json');
  assert.deepEqual(periodInfo(col.periodIndex), {
    sectionIndex: 4,
    dayInSection: 3,
    kind: 'war',
    warDay: 1,
  });
});

test('season inference: live wins; section walking backwards means a roll', () => {
  assert.equal(inferSeasonId(136, null), 136);
  assert.equal(inferSeasonId(undefined, { seasonId: 135, sectionIndex: 4, liveSectionIndex: 4 }), 135);
  assert.equal(inferSeasonId(undefined, { seasonId: 135, sectionIndex: 4, liveSectionIndex: 0 }), 136);
  assert.equal(inferSeasonId(undefined, null), null);
});

test('clock: fresh anchor beats the nominal grid; stale anchor falls back', async () => {
  const col = await fixture('currentriverrace/colosseum.json');
  const anchor = Date.parse('2026-09-03T09:37:00Z'); // observed-style drift
  const now = Date.parse('2026-09-03T14:40:34Z');
  const anchored = warClock(col, { nowMs: now, anchorMs: anchor });
  assert.equal(anchored.anchored, true);
  assert.equal(anchored.periodStartMs, anchor);
  assert.equal(anchored.kind, 'colosseum', 'payload periodType wins for display');
  assert.equal(anchored.warDay, 1, 'the %7 grid decides numbering');

  const stale = warClock(col, { nowMs: now, anchorMs: anchor - 3 * 86400_000 });
  assert.equal(stale.anchored, false);
  assert.equal(stale.periodStartMs, nominalPeriodStartMs(now), 'stale anchor never goes negative');
});

test('clock rejects a periodIndex outside its sectionIndex', async () => {
  const war = await fixture('currentriverrace/war_day.json');
  assert.throws(() => warClock({ ...war, sectionIndex: war.sectionIndex + 1 }, { nowMs: Date.now() }));
});

test('war keys come from the battle time, walking whole war-dates back', async () => {
  const war = await fixture('currentriverrace/war_day.json'); // p27, warDay 4
  const anchor = Date.parse('2026-08-31T09:40:00Z');
  const clock = warClock(war, { nowMs: Date.parse('2026-08-31T12:00:00Z'), anchorMs: anchor, logged: { seasonId: 136, sectionIndex: 3 } });

  // In the current period.
  assert.deepEqual(resolveWarKeys(Date.parse('2026-08-31T11:00:00Z'), clock), {
    seasonId: 136,
    sectionIndex: 3,
    warDay: 4,
  });
  // 30h before the anchor -> two war-dates back -> warDay 2.
  assert.deepEqual(resolveWarKeys(anchor - 30 * 3600_000, clock), {
    seasonId: 136,
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
