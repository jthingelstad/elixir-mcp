import test from "node:test";
import assert from "node:assert/strict";
import { seasonReport } from "../src/season.mjs";
import { seasonRecordFixture } from "./fixture.mjs";

const report = (fixture) => seasonReport(fixture.part, fixture);

test("season: known counters include former members once; unrelated activity is excluded", () => {
  const f = seasonRecordFixture();
  f.part.members[0].donations = [99999];
  f.part.members[0].battles = [99999];
  f.part.former_members.push({ ...f.part.members[0] });
  const prior = report(f).seasons[1];
  assert.equal(prior.decks, 84);
  assert.equal(prior.points, 18100);
  assert.equal(prior.contributors, 3);
  assert.equal(prior.state, "closed");
  assert.equal(
    prior.incomplete,
    true,
    "a missing member reading is still unknown",
  );
  assert.equal(prior.coverage.current_members, 2);
  assert.equal(prior.coverage.former_members, 1);
  assert.deepEqual(
    prior.races.map((r) => r.section_index),
    [0, 1, 2, 3],
  );
  assert.deepEqual(
    prior.races.map((r) => r.decks),
    [24, 24, 12, 24],
  );
  assert.equal(prior.races[1].counters_unknown, true);
  assert.equal(prior.races[2].counters_unknown, false);
  assert.equal(prior.donations, undefined);
  assert.equal(prior.battles, undefined);
});

test("season: observed zero differs from no capture; future sections are upcoming", () => {
  const f = seasonRecordFixture();
  const current = report(f).seasons[0];
  assert.equal(current.state, "open");
  assert.equal(current.decks, 0);
  assert.equal(current.contributors, 0);
  assert.deepEqual(
    current.races.map((r) => r.state),
    ["open", "upcoming", "upcoming", "upcoming"],
  );
  f.part.war_weeks.pop();
  const pending = report(f).seasons[0];
  assert.equal(pending.decks, null);
  assert.equal(pending.points, null);
  assert.equal(pending.contributors, null);
  assert.deepEqual(
    pending.races.map((r) => r.state),
    ["missing", "upcoming", "upcoming", "upcoming"],
  );
});

test("season: an internal gap or older unfinished section is not zero or a live race", () => {
  const f = seasonRecordFixture();
  f.part.war_weeks[1].section_index = 99;
  f.part.war_weeks[2].finished_observed_at = null;
  const prior = report(f).seasons[1];
  assert.equal(prior.races[1].state, "missing");
  assert.equal(prior.races[1].decks, null);
  assert.equal(prior.races[2].state, "unconfirmed");
  assert.equal(prior.state, "unconfirmed");
  assert.equal(prior.coverage.missing_sections, 1);
  assert.equal(prior.incomplete, true);
});

test("season: eight-week truncation and late roster recording prevent complete claims", () => {
  const f = seasonRecordFixture();
  f.part.applied.window.from = "2026-09-14T00:00:00Z";
  f.part.first_roster_observed_at = "2026-09-08T10:00:00Z";
  const prior = report(f).seasons[1];
  assert.equal(prior.coverage.before_window, true);
  assert.equal(prior.coverage.roster_started_late, true);
});

test("season: four/five-week calendars and delayed rollover closure stay distinct", () => {
  const f = seasonRecordFixture();
  f.calendar.seasons[1].sections = 5;
  f.part.war_weeks[3].is_colosseum = false;
  const prior = report(f).seasons[1];
  assert.equal(prior.races.length, 5);
  assert.equal(prior.coverage.missing_sections, 1);
  assert.equal(prior.incomplete, true);
  // A later recorded season proves that the prior one ended, not that
  // the missing fifth section was captured.
  assert.equal(prior.state, "closed");
  f.part.war_weeks[3].finished_observed_at = null;
  assert.equal(report(f).seasons[1].state, "unconfirmed");
});

test("season: absent/invalid counter readings remain unknown", () => {
  const f = seasonRecordFixture();
  for (const row of [...f.part.members, ...f.part.former_members]) {
    row.war_decks = [null, -1, 0.5, NaN, undefined];
    row.war_points = [];
  }
  const prior = report(f).seasons[1];
  assert.equal(prior.decks, null);
  assert.equal(prior.points, null);
  assert.equal(prior.contributors, null);
  assert.equal(prior.coverage.counters_unknown, true);
});

test("season: five captured races retain a complete represented record and deduplicate returning players", () => {
  const f = seasonRecordFixture();
  const s = f.calendar.seasons[1];
  Object.assign(s, {
    season_id: 135,
    from: "2026-08-03T10:00:00Z",
    to: "2026-09-07T10:00:00Z",
    sections: 5,
  });
  f.part.applied.window.from = "2026-07-01T00:00:00Z";
  f.part.war_weeks = Array.from({ length: 5 }, (_, i) => ({
    season_id: 135,
    section_index: i,
    is_colosseum: i === 4,
    started_observed_at: new Date(
      Date.parse(s.from) + i * 7 * 86400_000,
    ).toISOString(),
    finished_observed_at: new Date(
      Date.parse(s.from) + (i + 1) * 7 * 86400_000,
    ).toISOString(),
  }));
  for (const row of [...f.part.members, ...f.part.former_members]) {
    row.war_decks = [1, 2, 3, 4, 5];
    row.war_points = [100, 200, 300, 400, 500];
  }
  // A returning player's former representation carries partial lower readings.
  // It cannot add a second player or replace the known high-water counter.
  f.part.former_members.push({
    player_tag: f.part.members[0].player_tag,
    war_decks: [null, 1, 2, 3, 4],
    war_points: [null, 100, 200, 300, 400],
  });
  const prior = report(f).seasons[1];
  assert.equal(prior.state, "closed");
  assert.equal(prior.incomplete, false);
  assert.equal(prior.coverage.recorded_sections, 5);
  assert.equal(prior.coverage.current_members, 2);
  assert.equal(prior.coverage.former_members, 1);
  assert.equal(prior.decks, 45);
  assert.equal(prior.points, 4500);
  assert.equal(prior.contributors, 3);
  assert.equal(prior.races[4].is_colosseum, true);
});
