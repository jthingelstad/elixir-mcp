/**
 * People to follow, Find's sections and the race line (2026-11-12): every
 * line a fact in game names, never a rating, and a cost on every Follow.
 * Invented players only.
 */
import { describe, expect, test } from "vitest";
import {
  costMark,
  metLine,
  raceNowLine,
  slotsLine,
  whyLine,
  whyLines,
} from "../src/home/logic.js";
import { FIND_SECTIONS, findSections } from "../src/home/Find.jsx";

describe("why a person is suggested", () => {
  test("from your battles, as how often", () => {
    expect(whyLine({ kind: "battles", against: 2, with_you: 0, days: 7 })).toBe(
      "You played them twice this week",
    );
    expect(whyLine({ kind: "battles", against: 3, with_you: 0, days: 7 })).toBe(
      "You played them 3 times this week",
    );
    expect(whyLine({ kind: "battles", against: 0, with_you: 1, days: 7 })).toBe(
      "Your 2v2 teammate once this week",
    );
    expect(whyLine({ kind: "battles", against: 2, with_you: 1, days: 7 })).toBe(
      "You played them twice, teamed up once this week",
    );
  });

  test("your clan, and the players you follow, by game name", () => {
    expect(whyLine({ kind: "clan", clan_name: "Grove" })).toBe("In your clan");
    expect(
      whyLine({
        kind: "followed_by",
        via: { tag: "#PYLQGRJC", name: "Grace" },
        others: 0,
      }),
    ).toBe("Followed by Grace, who you follow");
    expect(
      whyLine({
        kind: "followed_by",
        via: { tag: "#PYLQGRJC", name: null },
        others: 2,
      }),
    ).toBe("Followed by #PYLQGRJC and 2 others you follow");
  });

  test("every reason, joined", () => {
    expect(
      whyLines([
        { kind: "clan" },
        { kind: "battles", against: 2, with_you: 0, days: 7 },
      ]),
    ).toBe("In your clan · You played them twice this week");
  });
});

test("the cost mark: free, a slot, or already followed", () => {
  expect(costMark({ free: true })).toBe("Free · already recorded");
  expect(costMark({ free: false })).toBe("Uses a slot");
  expect(costMark({ following: true, free: false })).toBe("Following");
  expect(slotsLine(3, 50)).toBe("Your follows: 3 of 50 slots");
  expect(slotsLine(3, null)).toBeNull();
});

test("From your battles: how often you met and how it went, from the log", () => {
  const when = (ts) => `at ${ts}`;
  expect(
    metLine(
      {
        against: 3,
        with_you: 0,
        wins: 2,
        losses: 1,
        draws: 0,
        last_met: "T",
      },
      when,
    ),
  ).toBe("Met 3 times · 2 wins, 1 loss · last at T");
  expect(
    metLine(
      { against: 0, with_you: 2, wins: 0, losses: 0, last_met: null },
      when,
    ),
  ).toBe("Your 2v2 teammate twice");
});

describe("this week's race", () => {
  const base = {
    season_id: 137,
    section_index: 1,
    is_colosseum: false,
    war_day: 2,
  };
  test("a war day: the place by fame and the fame, never decks or of N", () => {
    expect(
      raceNowLine({ ...base, day_kind: "war", place: 2, fame: 8200 }),
    ).toBe("Season 137, week 2, war day 2: 2nd by fame, 8,200 fame");
  });
  test("training days, a finished race, nothing", () => {
    expect(raceNowLine({ ...base, day_kind: "training", war_day: null })).toBe(
      "Season 137, week 2: training days",
    );
    expect(
      raceNowLine({ ...base, day_kind: "war", finished: true, place: 1 }),
    ).toBe("Season 137, week 2: finished");
    expect(
      raceNowLine({ ...base, is_colosseum: true, day_kind: "war", place: 3 }),
    ).toBe("Season 137, Colosseum, war day 2: 3rd by fame");
    expect(raceNowLine(null)).toBeNull();
  });
});

test("Find's sections: no Near you, and your own only with a player", () => {
  expect(FIND_SECTIONS.map((t) => t.label)).toEqual([
    "Your clan",
    "Search",
    "From your battles",
    "Clan directory",
    "Your link",
  ]);
  expect(FIND_SECTIONS.some((t) => /near/i.test(t.label))).toBe(false);
  expect(findSections(false).map((t) => t.key)).toEqual([
    "search",
    "directory",
  ]);
});
