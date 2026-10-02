/**
 * Ladder's Days page shaping (lib/ladder-days.js): the season's battles
 * laid on the account's calendar and chained into nights. These pin the
 * seams where a day or a night could invent a number: which day a late
 * battle lands on, a boat defense, a day the sweep never reached, a
 * night's record across modes, the trophies a floor loss leaves.
 */
import { test, expect } from "vitest";
import {
  addDays,
  battlePath,
  battleScore,
  battleWho,
  counted,
  daysPlayed,
  localDate,
  longestBreak,
  modeDays,
  nightLine,
  nightsOf,
  seasonCalendar,
  spanLabel,
  timeSpan,
  weekdayIndex,
  weekdayLabel,
  zoneName,
} from "../src/lib/ladder-days.js";

const CHI = "America/Chicago";
const SEASON = {
  startsAt: "2026-09-07T10:00:00.000Z",
  endsAt: "2026-10-05T10:00:00.000Z",
};
// Tuesday, September 29, 4:00 pm Central.
const NOW = Date.parse("2026-09-29T21:00:00Z");

let n = 0;
function battle(time, mode, outcome, extra = {}) {
  n++;
  return {
    battle_id: `b${n}`,
    url: extra.url ?? null,
    battle_time: time,
    mode_group: mode,
    ...(extra.boat ? { boat: { side: extra.boat } } : {}),
    me: {
      outcome,
      crowns: extra.crowns ?? (outcome === "win" ? 1 : 0),
      starting_trophies: extra.start ?? null,
      trophy_change: extra.change ?? null,
    },
    opponents: [
      {
        name: extra.opp ?? "Rival",
        player_tag: "#RIVAL",
        crowns: extra.against ?? (outcome === "win" ? 0 : 1),
      },
    ],
  };
}

test("a battle lands on the day it started in the account's zone", () => {
  // 11:30 pm Central on the 28th is 04:30 UTC on the 29th.
  expect(localDate("2026-09-29T04:30:00Z", CHI)).toBe("2026-09-28");
  expect(localDate("2026-09-29T04:30:00Z", "UTC")).toBe("2026-09-29");
  expect(localDate("2026-09-29T04:30:00Z", "Not/AZone")).toBe("2026-09-29");
  expect(localDate(null, CHI)).toBe(null);
  expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
  expect(weekdayIndex("2026-09-07")).toBe(0);
  expect(weekdayIndex("2026-10-04")).toBe(6);
  expect(weekdayLabel("2026-09-28")).toBe("Mon, Sep 28");
  expect(zoneName(CHI)).toBe("Central time");
  expect(zoneName("UTC")).toBe("UTC");
  expect(zoneName("Not/AZone")).toBe("UTC");
});

test("the calendar: every season day, each mode its own record, today and the days to come", () => {
  const battles = [
    battle("2026-09-08T02:00:00Z", "ladder", "win"), // Sep 7, 9 pm
    battle("2026-09-10T01:00:00Z", "war", "win"),
    battle("2026-09-10T01:10:00Z", "war", "loss"),
    battle("2026-09-10T01:20:00Z", "ladder", "loss"),
    battle("2026-09-10T01:30:00Z", "event", "draw"),
    // A boat defense is not the member's battle, and a row with no
    // outcome is not a result: neither is counted.
    battle("2026-09-10T01:40:00Z", "war", "loss", { boat: "defender" }),
    battle("2026-09-10T01:50:00Z", "ladder", null),
    battle("2026-09-12T01:40:00Z", "war", "win", { boat: "attacker" }),
  ];
  const cal = seasonCalendar({ battles, ...SEASON, now: NOW, zone: CHI });
  expect(cal.lead).toBe(0);
  // Monday the 7th to Sunday, October 4: the season ends at 5:00 am on
  // the 5th, and no battle fell in those hours.
  expect(cal.days.length).toBe(28);
  expect(cal.days[0]).toMatchObject({ ymd: "2026-09-07", count: 1 });
  expect(cal.days.at(-1).ymd).toBe("2026-10-04");

  const sep9 = cal.days.find((d) => d.ymd === "2026-09-09");
  expect(sep9.count).toBe(4);
  expect(sep9.modes).toEqual([
    {
      key: "ladder",
      label: "Trophy Road",
      battles: 1,
      wins: 0,
      losses: 1,
      draws: 0,
    },
    { key: "war", label: "War", battles: 2, wins: 1, losses: 1, draws: 0 },
    { key: "event", label: "Event", battles: 1, wins: 0, losses: 0, draws: 1 },
  ]);
  expect(sep9.level).toBe(3);
  expect(cal.days.find((d) => d.ymd === "2026-09-11").count).toBe(1);
  expect(cal.days.find((d) => d.ymd === "2026-09-29").state).toBe("today");
  expect(cal.days.find((d) => d.ymd === "2026-09-30").state).toBe("future");
  expect(cal.days.find((d) => d.ymd === "2026-09-28").state).toBe("past");

  expect(daysPlayed(cal.days)).toEqual({ played: 3, of: 23 });
  // Most battles first: war's three, then Trophy Road's two.
  expect(modeDays(cal.days).map((m) => [m.key, m.days, m.battles])).toEqual([
    ["war", 2, 3],
    ["ladder", 2, 2],
    ["event", 1, 1],
  ]);
});

test("a battle in the season's last hours adds that morning's day", () => {
  const cal = seasonCalendar({
    battles: [battle("2026-10-05T08:00:00Z", "ladder", "win")], // 3 am
    ...SEASON,
    now: Date.parse("2026-10-05T09:00:00Z"),
    zone: CHI,
  });
  expect(cal.days.at(-1)).toMatchObject({ ymd: "2026-10-05", count: 1 });
});

test("a capped sweep marks the days it did not reach as not read, never as empty", () => {
  const battles = [
    battle("2026-09-20T02:00:00Z", "ladder", "win"), // Sep 19
    battle("2026-09-16T02:00:00Z", "ladder", "loss"), // Sep 15, oldest read
  ];
  const cal = seasonCalendar({
    battles,
    ...SEASON,
    now: NOW,
    zone: CHI,
    readFrom: battles.at(-1).battle_time,
  });
  const state = (ymd) => cal.days.find((d) => d.ymd === ymd);
  expect(state("2026-09-07").state).toBe("unread");
  // The oldest day read may be partial, so it is not drawn either.
  expect(state("2026-09-15")).toMatchObject({ state: "unread", count: 0 });
  expect(state("2026-09-16").state).toBe("past");
  expect(state("2026-09-19").count).toBe(1);
  expect(daysPlayed(cal.days)).toEqual({ played: 1, of: 14 });
  // An unread day is not a break.
  expect(longestBreak(cal.days)).toEqual({
    from: "2026-09-20",
    to: "2026-09-28",
    length: 9,
  });
});

test("the longest break is whole days before today, and its span reads as prose", () => {
  const days = [
    { ymd: "2026-09-07", state: "past", count: 0 },
    { ymd: "2026-09-08", state: "past", count: 2 },
    { ymd: "2026-09-09", state: "past", count: 0 },
    { ymd: "2026-09-10", state: "past", count: 0 },
    { ymd: "2026-09-11", state: "today", count: 0 },
    { ymd: "2026-09-12", state: "future", count: 0 },
  ];
  expect(longestBreak(days)).toEqual({
    from: "2026-09-09",
    to: "2026-09-10",
    length: 2,
  });
  expect(longestBreak(days.slice(1, 2))).toBe(null);
  expect(spanLabel({ from: "2026-09-13", to: "2026-09-14", length: 2 })).toBe(
    "Sep 13 and 14",
  );
  expect(spanLabel({ from: "2026-09-25", to: "2026-09-25", length: 1 })).toBe(
    "Sep 25",
  );
  expect(spanLabel({ from: "2026-09-13", to: "2026-09-16", length: 4 })).toBe(
    "Sep 13 to 16",
  );
  expect(spanLabel({ from: "2026-09-30", to: "2026-10-02", length: 3 })).toBe(
    "Sep 30 to Oct 2",
  );
});

test("nights: runs with no gap over half an hour, newest first, each mode its own record", () => {
  const battles = [
    // Monday the 28th: two events, then three on Trophy Road down to
    // the floor (the last loss stands on it and carries no change).
    battle("2026-09-29T03:37:00Z", "event", "loss"),
    battle("2026-09-29T03:45:00Z", "event", "loss"),
    battle("2026-09-29T03:55:00Z", "ladder", "loss", {
      start: 12530,
      change: -15,
    }),
    battle("2026-09-29T04:10:00Z", "ladder", "loss", {
      start: 12515,
      change: -15,
    }),
    // Exactly 30 minutes on: the same night.
    battle("2026-09-29T04:40:00Z", "ladder", "loss", { start: 12500 }),
    // 31 minutes on: a new night.
    battle("2026-09-29T05:11:00Z", "ladder", "win", {
      start: 12500,
      change: 30,
    }),
    // A boat defense never joins a night.
    battle("2026-09-29T05:20:00Z", "war", "loss", { boat: "defender" }),
  ];
  const nights = nightsOf([...battles].reverse(), CHI);
  expect(nights.length).toBe(2);
  const [late, night] = nights;
  expect(late.battles.length).toBe(1);
  expect(late.trophies).toEqual({ from: 12500, to: 12530 });

  expect(night.day).toBe("2026-09-28");
  expect(timeSpan(night.start, night.end, CHI)).toBe("10:37 – 11:40 pm");
  expect(
    night.sequence.map((s) => [s.key, s.battles, s.wins, s.losses]),
  ).toEqual([
    ["event", 2, 0, 2],
    ["ladder", 3, 0, 3],
  ]);
  expect(nightLine(night.sequence)).toBe(
    "2 event battles, then 3 on Trophy Road",
  );
  expect(night.modes.map((m) => m.key)).toEqual(["ladder", "event"]);
  // The floor loss costs nothing: the night ends on the floor.
  expect(night.trophies).toEqual({ from: 12530, to: 12500 });
  // Newest first inside a night too.
  expect(night.battles.map((b) => b.battle_time)).toEqual(
    battles
      .slice(0, 5)
      .map((b) => b.battle_time)
      .reverse(),
  );
});

test("a night's words: a span across noon or midnight, one battle, war and casual", () => {
  expect(timeSpan("2026-09-29T04:50:00Z", "2026-09-29T05:20:00Z", CHI)).toBe(
    "11:50 pm – 12:20 am",
  );
  expect(timeSpan("2026-09-29T04:50:00Z", "2026-09-29T04:50:00Z", CHI)).toBe(
    "11:50 pm",
  );
  expect(
    nightLine([
      { key: "war", label: "War", battles: 1 },
      { key: "casual", label: "Casual", battles: 2 },
      { key: "ranked", label: "Path of Legends", battles: 4 },
    ]),
  ).toBe("1 war battle, then 2 casual battles, then 4 on Path of Legends");
});

test("a battle row names its opponents and score, and links only a url the tool gave", () => {
  const b = battle("2026-09-29T03:37:00Z", "ladder", "win", {
    crowns: 3,
    against: 1,
    opp: "Lucky Red Panda",
    url: "https://elixir.poapkings.com/battle/0123456789ab",
  });
  expect(battleWho(b)).toBe("Lucky Red Panda");
  expect(battleScore(b)).toBe("won 3–1");
  expect(battlePath(b.url)).toBe("/battle/0123456789ab");
  expect(battleWho({ opponents: [{ name: "A" }, { player_tag: "#B" }] })).toBe(
    "A and #B",
  );
  expect(battleWho({ opponents: [] })).toBe("Unknown opponent");
  expect(battleScore({ me: { outcome: "draw" }, opponents: [] })).toBe("drew");
  expect(counted({ me: { outcome: "win" }, boat: { side: "attacker" } })).toBe(
    true,
  );
});
