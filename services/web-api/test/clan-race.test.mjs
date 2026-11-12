/**
 * The clan card's race read (G5, 2026-11-12): weekly facts only. Decks
 * are the race week's cumulative count over four a war day for each
 * current member up to the finish; a member who has left counts on
 * neither side. Synthetic clans and players only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readClanRace, shapeClanRace } from "../src/clan-race.mjs";

const OURS = "#2PQRJ8LV";
const NOW = Date.parse("2026-11-13T18:00:00Z");

function race(over = {}) {
  return {
    season_id: 140,
    section_index: 1,
    is_colosseum: false,
    day_kind: "war",
    war_day: 2,
    race_finished_at: null,
    finish_war_day: null,
    next_war_day_opens_at: "2026-11-14T10:00:00.000Z",
    standings: [
      { participant_clan_tag: "#8QQ9PY0", fame: 6100 },
      { participant_clan_tag: OURS, fame: 4820 },
      { participant_clan_tag: "#9GG2LR8", fame: 3000 },
      { participant_clan_tag: "#CV0Y2PQ", fame: 1200 },
      { participant_clan_tag: "#UQ8LJ22", fame: 0 },
    ],
    participants: [
      { player_tag: "#2Q8U0LV", decks_used: 8, in_clan: true },
      { player_tag: "#8JJ9QYU", decks_used: 5, in_clan: true },
      { player_tag: "#9PRY2GC", decks_used: 0, in_clan: true },
      { player_tag: "#LQ2VC80", decks_used: 6, in_clan: false },
    ],
    period: { week_end_nominal: "2026-11-16T10:00:00.000Z" },
    ...over,
  };
}

test("an open race: place of the clans, fame, the week's decks and the close", () => {
  const r = shapeClanRace(race(), OURS, NOW);
  assert.equal(r.place, 2);
  assert.equal(r.fame, 4820);
  assert.equal(r.clans, 5);
  assert.equal(r.war_day, 2);
  assert.equal(r.closes_at, "2026-11-16T10:00:00.000Z");
  // Three current members, two war days so far: 24 asked, 13 played.
  assert.deepEqual(r.decks, { used: 13, asked: 24 });
});

test("a member left out of the race roster is asked for decks too", () => {
  const r = shapeClanRace(
    race({
      members_not_in_race: [
        { player_tag: "#Q0RLV8C", reason: "not_in_race_roster" },
      ],
    }),
    OURS,
    NOW,
  );
  // Four current members, two war days: 32 asked, still 13 played.
  assert.deepEqual(r.decks, { used: 13, asked: 32 });
});

test("a finished race asks no decks after the finish", () => {
  const r = shapeClanRace(
    race({
      war_day: 4,
      race_finished_at: "2026-11-15T09:40:00.000Z",
      finish_war_day: 3,
    }),
    OURS,
    NOW + 2 * 86_400_000,
  );
  assert.equal(r.finished, true);
  assert.deepEqual(r.decks, { used: 13, asked: 36 });
});

test("training days carry no decks and no place", () => {
  const r = shapeClanRace(race({ day_kind: "training", war_day: null }), OURS);
  assert.equal(r.day_kind, "training");
  assert.equal(r.decks, undefined);
  assert.equal(r.place, undefined);
  assert.equal(r.war_day_opens_at, "2026-11-14T10:00:00.000Z");
});

test("no race recorded is no race, and another refusal is an error", async () => {
  const notRecorded = async () => ({
    isError: true,
    body: { error: { code: "not_recorded", message: "no race" } },
  });
  assert.deepEqual(await readClanRace(notRecorded, OURS), { race: null });
  const down = async () => ({
    isError: true,
    body: { error: { code: "timeout", message: "slow" } },
  });
  await assert.rejects(readClanRace(down, OURS), { code: "timeout" });
  const asked = [];
  const ok = async (name, args) => {
    asked.push([name, args]);
    return { isError: false, body: race() };
  };
  const { race: r } = await readClanRace(ok, OURS, NOW);
  assert.equal(r.place, 2);
  assert.deepEqual(asked, [["war_current", { clan_tag: OURS }]]);
});
