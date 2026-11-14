/**
 * People to follow, Find's sections and the race line (2026-11-12): every
 * line a fact in game names, never a rating, and a cost on every Follow.
 * Invented players only.
 */
import { describe, expect, test } from "vitest";
import {
  costMark,
  lastMetLine,
  metLine,
  raceNowLine,
  offersStarter,
  slotsLine,
  starterPlan,
  STARTER_UNDER,
  whyLine,
  whyLines,
} from "../src/home/logic.js";
import { FIND_SECTIONS, findSections } from "../src/home/Find.jsx";

describe("why a person is suggested", () => {
  test("from your battles: friendlies first, then teammates, then how often", () => {
    const b = (o) => ({
      kind: "battles",
      against: 0,
      with_you: 0,
      friendly: 0,
      clanmate_battles: 0,
      days: 7,
      ...o,
    });
    expect(whyLine(b({ against: 1, friendly: 1 }))).toBe(
      "You played a friendly battle this week",
    );
    expect(whyLine(b({ against: 4, friendly: 2, clanmate_battles: 1 }))).toBe(
      "You played 2 friendly battles and a clan friendly, and once more this week",
    );
    expect(whyLine(b({ against: 2 }))).toBe("You played them twice this week");
    expect(whyLine(b({ against: 3 }))).toBe(
      "You played them 3 times this week",
    );
    expect(whyLine(b({ with_you: 1 }))).toBe("Your 2v2 teammate this week");
    expect(whyLine(b({ with_you: 2, days: 30 }))).toBe(
      "Your 2v2 teammate twice in the last 30 days",
    );
    expect(whyLine(b({ against: 2, with_you: 1 }))).toBe(
      "You played them twice, your 2v2 teammate this week",
    );
  });

  test("your clan: already in Elixir, or when they last played", () => {
    const dayHeading = (at) =>
      at === "T" ? "Today" : at === "Y" ? "Yesterday" : "Monday, November 9";
    expect(whyLine({ kind: "clan", clan_name: "Grove" })).toBe("In your clan");
    expect(whyLine({ kind: "clan", recorded: true })).toBe(
      "In your clan, already in Elixir",
    );
    expect(whyLine({ kind: "clan", last_battle: "T" }, { dayHeading })).toBe(
      "In your clan, played today",
    );
    expect(whyLine({ kind: "clan", last_battle: "Y" }, { dayHeading })).toBe(
      "In your clan, played yesterday",
    );
    expect(whyLine({ kind: "clan", last_battle: "N" }, { dayHeading })).toBe(
      "In your clan, last played Monday, November 9",
    );
    // No clock: no day.
    expect(whyLine({ kind: "clan", last_battle: "T" })).toBe("In your clan");
  });

  test("the players you follow, by game name", () => {
    expect(
      whyLine({
        kind: "followed_by",
        via: { tag: "#0J0RVYRR", name: "Grace" },
        others: 0,
      }),
    ).toBe("Grace follows them");
    expect(
      whyLine({
        kind: "followed_by",
        via: { tag: "#0J0RVYRR", name: null },
        others: 2,
      }),
    ).toBe("#0J0RVYRR follows them, and 2 more you follow");
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

describe("the starter set", () => {
  const people = [
    { tag: "#0G2ULUJP", free: true },
    { tag: "#0JCCC08Q", free: false },
    { tag: "#0Q2UQ2YR", free: false },
  ];
  test("its plan counts the free and the slots, and fits the slots left", () => {
    const plan = starterPlan(people, 8, 10);
    expect(plan).toMatchObject({
      to_follow: 3,
      free: 1,
      slots: 2,
      following: 0,
      used: 8,
      limit: 10,
      fits: true,
    });
    expect(plan.players.map((p) => p.player_tag)).toEqual(
      people.map((p) => p.tag),
    );
    expect(starterPlan(people, 9, 10).fits).toBe(false);
    expect(starterPlan(people, 9, null).fits).toBe(true);
    expect(starterPlan([people[0]], 10, 10).fits).toBe(true);
  });
  test("offered on every visit while fewer than five are followed, unless put aside", () => {
    const now = Date.parse("2026-11-13T12:00:00Z");
    const first = (following, until = null, finished = null) => ({
      welcome: { following, finished_at: finished },
      starter_hidden_until: until,
    });
    expect(offersStarter(first(0), now)).toBe(true);
    expect(offersStarter(first(4, null, "2026-11-01T00:00:00Z"), now)).toBe(
      true,
    );
    expect(offersStarter(first(5), now)).toBe(false);
    expect(offersStarter(first(0, "2026-12-01T00:00:00Z"), now)).toBe(false);
    expect(offersStarter(first(0, "2026-11-01T00:00:00Z"), now)).toBe(true);
    expect(STARTER_UNDER).toBe(5);
    expect(offersStarter({}, now)).toBe(false);
    expect(offersStarter(null, now)).toBe(false);
  });
});

test("the cost mark: a row says only when a follow is free", () => {
  expect(costMark({ free: true })).toBe("Free");
  expect(costMark({ free: false })).toBeNull();
  expect(costMark({ following: true, free: true })).toBeNull();
  expect(slotsLine(3, 50)).toBe("3 of your 50 follows used");
  expect(slotsLine(3, null)).toBeNull();
});

test("From your battles: how often you met and how it went, from the log", () => {
  expect(
    metLine({
      against: 3,
      with_you: 0,
      wins: 2,
      losses: 1,
      draws: 0,
      last_met: "T",
    }),
  ).toBe("Met 3 times · 2 wins, 1 loss");
  expect(
    metLine({ against: 0, with_you: 2, wins: 0, losses: 0, last_met: null }),
  ).toBe("Your 2v2 teammate twice");
  expect(
    metLine({
      friendly: 1,
      against: 1,
      with_you: 0,
      wins: 1,
      losses: 0,
      last_met: "T",
    }),
  ).toBe("A friendly battle · Met once · 1 win");
});

test("From your battles: when you last met, in Home's words", () => {
  const feedWhen = (ts) => ({ a: "Today, 3:52 pm", b: "Tue, 4:53 am" })[ts];
  expect(lastMetLine({ last_met: "a" }, feedWhen)).toBe(
    "Last met today, 3:52 pm",
  );
  expect(lastMetLine({ last_met: "b" }, feedWhen)).toBe(
    "Last met Tue, 4:53 am",
  );
  expect(lastMetLine({ last_met: null }, feedWhen)).toBeNull();
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
    // No place (nothing banked yet, or level with another clan): the fame
    // alone, or the day alone.
    expect(raceNowLine({ ...base, day_kind: "war", fame: 4000 })).toBe(
      "Season 137, week 2, war day 2: 4,000 fame",
    );
    expect(raceNowLine({ ...base, day_kind: "war", fame: 0 })).toBe(
      "Season 137, week 2, war day 2",
    );
    expect(raceNowLine(null)).toBeNull();
  });
});

test("Find's sections: Suggested first, no Near you, and your own only with a player", () => {
  expect(FIND_SECTIONS.map((t) => t.label)).toEqual([
    "Suggested",
    "Your clan",
    "Search",
    "From your battles",
    "Clan directory",
    "Your link",
  ]);
  expect(FIND_SECTIONS.some((t) => /near/i.test(t.label))).toBe(false);
  expect(findSections(false).map((t) => t.key)).toEqual([
    "suggested",
    "search",
    "directory",
  ]);
});
