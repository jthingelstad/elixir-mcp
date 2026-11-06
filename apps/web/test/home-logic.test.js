import { describe, expect, test } from "vitest";
import {
  clanStepLine,
  friendsView,
  gameLine,
  lastRaceLine,
  needsYou,
  timelineDays,
  weekChips,
} from "../src/home/logic.js";

const clock = { when: (ts) => `at ${ts}` };
const clan = (over = {}) => ({
  ok: true,
  state: "member",
  clan_tag: "#2PQRJ8LV",
  name: "Clan",
  role: "leader",
  policy_set: true,
  members: 40,
  min_members: 10,
  needs: [],
  needs_total: 0,
  ...over,
});

describe("Needs you", () => {
  test("nothing needs you: no rows, so the panel is not drawn", () => {
    expect(needsYou({ clan: clan(), clock }).rows).toEqual([]);
  });

  test("keeps Clan's order, says how many more, addresses by number", () => {
    const { rows, more } = needsYou({
      clan: clan({
        needs: [
          { type: "departure", number: 4, subject_name: "Ada" },
          { type: "removal", number: 2, subject_name: "Grace" },
        ],
        needs_total: 5,
      }),
      clock,
    });
    expect(rows.map((r) => r.title)).toEqual([
      "Departure: kicked, left, or ignore? Ada",
      "Remove from the clan: Grace",
    ]);
    expect(rows[0].to).toBe("/clan/2PQRJ8LV/actions/4");
    expect(more.title).toBe("and 3 more in Clan › Today");
  });

  test("an Action not numbered yet goes to the list", () => {
    const { rows } = needsYou({
      clan: clan({
        needs: [{ type: "welcome", number: null, subject_name: "Ada" }],
        needs_total: 1,
      }),
      clock,
    });
    expect(rows[0].to).toBe("/clan/2PQRJ8LV/actions");
  });

  test("Away goes to your own switch", () => {
    const { rows } = needsYou({
      clan: clan({
        role: "member",
        needs: [{ type: "away", days_idle: 8.2, away_max_days: 14 }],
        needs_total: 1,
      }),
      clock,
    });
    expect(rows[0].to).toBe("/clan/you/away");
    expect(rows[0].detail).toContain("8 days since your last recorded battle.");
  });

  test("a clan with no policy asks its leaders, not its members, and not a small clan", () => {
    const asks = (over) =>
      needsYou({ clan: clan({ policy_set: false, ...over }), clock }).rows
        .length;
    expect(asks({})).toBe(1);
    expect(asks({ role: "coLeader" })).toBe(1);
    expect(asks({ role: "member" })).toBe(0);
    expect(asks({ members: 5 })).toBe(0);
  });

  test("a refused credential is anyone's, after the clan's", () => {
    const { rows } = needsYou({
      clan: clan({ needs: [{ type: "welcome", number: 1 }], needs_total: 1 }),
      signals: { refusals_7d: 1 },
      clock,
    });
    expect(rows.at(-1).key).toBe("refusals");
    expect(
      needsYou({ clan: { ok: false }, signals: { refusals_7d: 1 }, clock }).rows
        .length,
    ).toBe(1);
  });
});

test("chips: Casual always, Events only with battles", () => {
  const keys = (m) => weekChips(m).map((c) => c.key);
  expect(keys({})).toEqual(["ladder", "ranked", "war", "casual"]);
  expect(keys({ event: { battles: 1 } })).toContain("event");
  expect(weekChips({})[0].label).toBe("Trophy Road");
});

test("last race: season, week, place and fame", () => {
  expect(
    lastRaceLine({
      season_id: 137,
      section_index: 3,
      rank: 2,
      fame: 84200,
    }),
  ).toBe("Season 137, week 4: 2nd, 84,200 fame");
  expect(
    lastRaceLine({ season_id: 137, is_colosseum: true, rank: 11, fame: null }),
  ).toBe("Season 137, Colosseum: 11th");
  expect(lastRaceLine(null)).toBe(null);
});

describe("Friends' lists", () => {
  const played = { tag: "#A", name: "Ada", battles: 3 };
  test("a quiet friend is named however long; a quiet watch splits at thirty days", () => {
    const v = friendsView({
      friends: [played],
      watching: [],
      quiet: [
        { tag: "#B", name: "Old friend", days: 90, relationship: "friend" },
        { tag: "#C", name: "Recent", days: 29, relationship: "watching" },
        { tag: "#D", name: "Long", days: 30, relationship: "watching" },
      ],
    });
    expect(v.friendsTotal).toBe(2);
    expect(v.friendsQuiet).toEqual(["Old friend"]);
    expect(v.watchingQuiet).toEqual(["Recent"]);
    expect(v.watchingLong).toEqual(["Long"]);
  });

  test("nobody at all, and nobody who played, are different pages", () => {
    expect(friendsView({ friends: [], watching: [], quiet: [] }).empty).toBe(
      true,
    );
    const quiet = friendsView({
      friends: [],
      watching: [],
      quiet: [{ tag: "#B", name: "B", days: 1, relationship: "friend" }],
    });
    expect(quiet.empty).toBe(false);
    expect(quiet.nobody).toBe(true);
  });
});

describe("Timeline days", () => {
  const items = [
    { id: 1, at: "2026-11-05T12:00:00Z", observed_at: "2026-11-05T12:00:00Z" },
    { id: 2, at: "2026-11-05T09:00:00Z", observed_at: "2026-11-05T09:00:00Z" },
    { id: 3, at: "2026-11-03T09:00:00Z", observed_at: "2026-11-03T09:00:00Z" },
  ];
  const day = (ts) => ts.slice(0, 10);
  test("groups by day and draws the line under the last new row", () => {
    const days = timelineDays(items, {
      day,
      openedMs: Date.parse("2026-11-05T08:00:00Z"),
    });
    expect(days.map((d) => d.rows.length)).toEqual([2, 1]);
    expect(days[0].rows.map((r) => r.newLine)).toEqual([false, true]);
  });
  test("a sitting sits on the day and order of its last battle, not its first", () => {
    const days = timelineDays(
      [
        {
          id: 1,
          at: "2026-11-04T23:30:00Z",
          sort_at: "2026-11-05T00:30:00Z",
        },
        { id: 2, at: "2026-11-04T23:40:00Z" },
      ],
      { day, openedMs: null },
    );
    expect(days.map((d) => d.key)).toEqual(["2026-11-05", "2026-11-04"]);
    expect(days[0].at).toBe("2026-11-05T00:30:00Z");
  });
  test("a first visit marks nothing new", () => {
    const days = timelineDays(items, { day, openedMs: null });
    expect(days.flatMap((d) => d.rows).some((r) => r.isNew)).toBe(false);
  });
});

describe("One recorded game in words", () => {
  const base = { outcome: "win", crowns: 3, mode_group: "ladder" };
  const opponent = {
    player_tag: "#B",
    name: "Rival",
    crowns: 0,
    clan_tag: "#C",
    clan_name: "Their clan",
  };
  test("says the result, score, who and mode", () => {
    expect(gameLine({ ...base, opponents: [opponent] })).toBe(
      "Win 3-0 against Rival, Trophy Road",
    );
  });
  test("a name the record has not read falls to the clan, then the tag", () => {
    expect(
      gameLine({ ...base, opponents: [{ ...opponent, name: null }] }),
    ).toBe("Win 3-0 against Their clan, Trophy Road");
    expect(
      gameLine({
        ...base,
        opponents: [{ ...opponent, name: null, clan_name: null }],
      }),
    ).toBe("Win 3-0 against #B, Trophy Road");
  });
  test("two opponents are both named", () => {
    expect(
      gameLine({
        ...base,
        opponents: [
          opponent,
          { ...opponent, player_tag: "#D", name: "Second" },
        ],
      }),
    ).toBe("Win 3-0 against Rival and Second, Trophy Road");
  });
  test("what the record cannot say is not said", () => {
    expect(gameLine({ ...base, opponents: [] })).toBe("Win, Trophy Road");
    expect(gameLine({ outcome: null, crowns: null, opponents: [] })).toBe(
      "Outcome unknown",
    );
    expect(gameLine({ ...base, crowns: null, opponents: [opponent] })).toBe(
      "Win against Rival, Trophy Road",
    );
  });
});

test("step 3 names a player only when there is one", () => {
  expect(clanStepLine("Clan", true)).toBe("Clan, your player’s clan.");
  expect(clanStepLine("Clan", false)).toBe("Clan, a clan you track.");
});
