/**
 * Stats' calendar and battle list shaping (stats/stats-days.js): the
 * season's battles laid on the account's calendar and chained into sittings.
 * These pin the seams where a day or a sitting could invent a number: which day
 * a late battle lands on, a boat defense, a day the sweep never reached, a day
 * a chip cannot speak for, the trophies a floor loss leaves.
 */
import { test, expect } from "vitest";
import {
  addDays,
  battlePath,
  battleScore,
  soloSittingLine,
  battleWho,
  battleDays,
  battleKind,
  battleOutcome,
  chipCalendar,
  counted,
  localDate,
  longestBreak,
  seasonCalendar,
  sittingsOf,
  tallyLine,
  spanLabel,
  timeSpan,
  weekdayIndex,
  weekdayLabel,
  zoneName,
} from "../src/stats/stats-days.js";

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
    ...(extra.boat ? { boat: { side: extra.boat, role: extra.boat } } : {}),
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
  expect(weekdayLabel("2026-09-28")).toBe("Mon Sep 28");
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

  // Each chip reads its own days from the one calendar.
  const on = (groups) => chipCalendar(cal, groups);
  expect([on(["ladder"]).played, on(["ladder"]).of]).toEqual([2, 23]);
  expect(on(["war"]).played).toBe(2);
  expect(on(["event"]).played).toBe(1);
  const war = on(["war"]).days.find((d) => d.ymd === "2026-09-09");
  expect([war.mine.battles, war.others, war.text]).toEqual([2, 2, "2 · 1–1"]);
});

test("quiet days require whole-day coverage; gaps and the unbracketed tail never form breaks", () => {
  const interval = (observed_from, observed_to, overrides = {}) => ({
    observed_from,
    observed_to,
    expected_battles: 0,
    captured_battles: 0,
    is_complete: true,
    ...overrides,
  });
  const cal = seasonCalendar({
    battles: [],
    ...SEASON,
    now: NOW,
    zone: CHI,
    observationIntervals: [
      interval("2026-09-24T04:00:00Z", "2026-09-26T05:00:00Z"),
      interval("2026-09-26T05:00:00Z", "2026-09-27T05:00:00Z", {
        is_complete: false,
        expected_battles: 3,
      }),
      interval("2026-09-27T05:00:00Z", "2026-09-28T05:00:00Z"),
    ],
  });
  const day = (date) => cal.days.find((d) => d.ymd === date);
  expect(day("2026-09-07").capture.quiet).toBe(false);
  expect(day("2026-09-24").capture.quiet).toBe(true);
  expect(day("2026-09-25").capture.quiet).toBe(true);
  expect(day("2026-09-26").capture.quiet).toBe(false);
  expect(day("2026-09-27").capture.quiet).toBe(false);
  expect(day("2026-09-28").capture.quiet).toBe(false);
  expect(day("2026-09-29").capture.quiet).toBe(false);
  expect(chipCalendar(cal, ["ladder"]).gap).toEqual({
    from: "2026-09-24",
    to: "2026-09-25",
    length: 2,
  });
});

test("a successful poll or a season-clipped day cannot establish zero play", () => {
  const cal = seasonCalendar({
    battles: [],
    ...SEASON,
    now: NOW,
    zone: CHI,
    observationIntervals: [
      {
        observed_from: "2026-09-06T00:00:00Z",
        observed_to: "2026-09-08T05:00:00Z",
        is_complete: true,
        expected_battles: 0,
        captured_battles: 0,
      },
    ],
  });
  expect(cal.days[0].capture.quiet).toBe(false);
  expect(chipCalendar(cal, ["ladder"]).gap).toBeNull();
});

test("quiet-day coverage respects both short and long DST days", () => {
  const cal = (date, end) =>
    seasonCalendar({
      battles: [],
      startsAt: `${date.slice(0, 7)}-01T00:00:00Z`,
      endsAt: `${date.slice(0, 7)}-28T00:00:00Z`,
      now: Date.parse(`${date.slice(0, 7)}-10T12:00:00Z`),
      zone: CHI,
      observationIntervals: [
        {
          observed_from: `${date}T04:00:00Z`,
          observed_to: end,
          is_complete: true,
          expected_battles: 0,
          captured_battles: 0,
        },
      ],
    }).days.find((d) => d.ymd === date);
  expect(cal("2026-03-08", "2026-03-09T05:00:00Z").capture.quiet).toBe(true);
  expect(cal("2026-11-01", "2026-11-02T05:00:00Z").capture.quiet).toBe(false);
  expect(cal("2026-11-01", "2026-11-02T06:00:00Z").capture.quiet).toBe(true);
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
  // A partial day retains its positive battle evidence.
  expect(state("2026-09-15")).toMatchObject({ state: "unread", count: 1 });
  expect(state("2026-09-16").state).toBe("past");
  expect(state("2026-09-19").count).toBe(1);
  const chip = chipCalendar(cal, ["ladder"]);
  expect([chip.played, chip.of]).toEqual([2, 23]);
  const cell = (ymd) => chip.days.find((d) => d.ymd === ymd);
  expect(cell("2026-09-07")).toMatchObject({ cls: "unread", text: "Not read" });
  // A partly read day keeps the battle it did read.
  expect(cell("2026-09-15").text).toBe("1 · 0–1");
  // An unread day is not a break.
  expect(chip.gap).toBeNull();
});

test("the longest break is whole days before today, and its span reads as prose", () => {
  const whole = { coverage: "complete" };
  const none = { battles: 0 };
  const days = [
    { ymd: "2026-09-07", state: "past", mine: none, capture: whole },
    { ymd: "2026-09-08", state: "past", mine: { battles: 2 }, capture: whole },
    { ymd: "2026-09-09", state: "past", mine: none, capture: whole },
    { ymd: "2026-09-10", state: "past", mine: none, capture: whole },
    { ymd: "2026-09-11", state: "today", mine: none, capture: whole },
    { ymd: "2026-09-12", state: "future", mine: none },
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

test("sittings: runs with no gap over half an hour, newest first, each mode its own record", () => {
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
    // Exactly 30 minutes on: the same sitting.
    battle("2026-09-29T04:40:00Z", "ladder", "loss", { start: 12500 }),
    // 31 minutes on: a new sitting.
    battle("2026-09-29T05:11:00Z", "ladder", "win", {
      start: 12500,
      change: 30,
    }),
    // A boat defense never joins a sitting.
    battle("2026-09-29T05:20:00Z", "war", "loss", { boat: "defender" }),
  ];
  const nights = sittingsOf([...battles].reverse(), CHI);
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
  expect(night.modes.map((m) => m.key)).toEqual(["ladder", "event"]);
  // The floor loss costs nothing: the sitting ends on the floor.
  expect(night.trophies).toEqual({ from: 12530, to: 12500 });
  // Newest first inside a sitting too.
  expect(night.battles.map((b) => b.battle_time)).toEqual(
    battles
      .slice(0, 5)
      .map((b) => b.battle_time)
      .reverse(),
  );
});

test("a span across noon or midnight, and one battle", () => {
  expect(timeSpan("2026-09-29T04:50:00Z", "2026-09-29T05:20:00Z", CHI)).toBe(
    "11:50 pm – 12:20 am",
  );
  expect(timeSpan("2026-09-29T04:50:00Z", "2026-09-29T04:50:00Z", CHI)).toBe(
    "11:50 pm",
  );
});

test("a battle row names its opponents and score, and links only a url the tool gave", () => {
  const b = battle("2026-09-29T03:37:00Z", "ladder", "win", {
    crowns: 3,
    against: 1,
    opp: "Ember Fox",
    url: "https://elixir.poapkings.com/battle/0123456789ab",
  });
  expect(battleWho(b)).toBe("Ember Fox");
  expect(battleScore(b)).toBe("won 3–1");
  expect(battlePath(b.url)).toBe("/battle/0123456789ab");
  expect(battleWho({ opponents: [{ name: "A" }, { player_tag: "#B" }] })).toBe(
    "A and #B",
  );
  expect(battleWho({ opponents: [] })).toBe("Unknown opponent");
  expect(battleScore({ me: { outcome: "draw" }, opponents: [] })).toBe("drew");
  expect(
    counted({
      me: { outcome: "win" },
      boat: { side: "attacker", role: "attacker" },
    }),
  ).toBe(true);
  // The record keeps the word of the log that recorded the battle; when
  // the other player's log came first, side is theirs and role is yours.
  expect(
    counted({
      me: { outcome: "win" },
      boat: { side: "defender", role: "attacker" },
    }),
  ).toBe(true);
  expect(
    counted({
      me: { outcome: "loss" },
      boat: { side: "attacker", role: "defender" },
    }),
  ).toBe(false);
});

test("a chip's calendar says only what the read can prove about a day", () => {
  const day = (ymd, extra) => ({
    ymd,
    label: ymd,
    state: "past",
    count: 0,
    modes: [],
    capture: { coverage: "none", quiet: false },
    ...extra,
  });
  const ladder = (battles) => ({
    key: "ladder",
    battles,
    wins: battles,
    losses: 0,
    draws: 0,
  });
  const cal = {
    lead: 0,
    days: [
      day("2026-09-07", { count: 9, modes: [ladder(9)] }),
      day("2026-09-08", { count: 3, modes: [ladder(3)] }),
      day("2026-09-09", {
        count: 4,
        modes: [{ key: "war", battles: 4, wins: 2, losses: 2, draws: 0 }],
      }),
      day("2026-09-10", { capture: { coverage: "complete", quiet: true } }),
      day("2026-09-11", { capture: { coverage: "partial", quiet: false } }),
      day("2026-09-12"),
      day("2026-09-13", { state: "unread" }),
      day("2026-09-14", { state: "today" }),
      day("2026-09-15", { state: "future" }),
    ],
  };
  const words = (opts) =>
    chipCalendar(cal, ["ladder"], opts).days.map((d) => [d.cls, d.text]);
  expect(words()).toEqual([
    ["l3", "9 · 9–0"],
    ["l1", "3 · 3–0"],
    ["other", "4 in other modes"],
    ["quiet", "No battles"],
    ["part", "Partly read"],
    ["unk", "Unknown"],
    ["unread", "Not read"],
    ["fut", "Still being read"],
    ["fut", ""],
  ]);
  // No coverage answer proves nothing: quiet and partly read become unknown.
  const failed = words({ coverageFailed: true });
  expect(failed[3]).toEqual(["unk", "Unknown"]);
  expect(failed[4]).toEqual(["unk", "Unknown"]);
  expect(
    chipCalendar(cal, ["ladder"], { coverageFailed: true }).gap,
  ).toBeNull();
});

test("a day groups its sittings, split at midnight as the calendar's day is", () => {
  const days = battleDays(
    [
      battle("2026-09-29T05:10:00Z", "ladder", "win"), // Sep 29, 12:10 am
      battle("2026-09-29T04:50:00Z", "ladder", "loss"), // Sep 28, 11:50 pm
      battle("2026-09-28T02:00:00Z", "ladder", "win"), // Sep 27
      battle("2026-09-29T04:55:00Z", "war", "loss", { boat: "defender" }),
    ],
    CHI,
  );
  expect(days.map((d) => [d.ymd, d.label, d.battles])).toEqual([
    ["2026-09-29", "Tue Sep 29", 1],
    ["2026-09-28", "Mon Sep 28", 1],
    ["2026-09-27", "Sun Sep 27", 1],
  ]);
  expect(days[0].sittings.length).toBe(1);
  expect(tallyLine(days[0])).toBe("1 battle · 1–0");
  expect(tallyLine({ battles: 6, wins: 3, losses: 2, draws: 1 })).toBe(
    "6 battles · 3–2–1",
  );
});

test("a row names its kind where a mode's rows differ", () => {
  const row = (mode_group, type, opponents = [{}]) => ({
    mode_group,
    type,
    opponents,
  });
  expect(battleKind(row("war", "riverRaceDuel"))).toBe("War duel");
  expect(battleKind(row("war", "boatBattle"))).toBe("Boat attack");
  expect(battleKind(row("war", "riverRacePvP"))).toBe("War battle");
  expect(battleKind(row("casual", "friendly"))).toBe("Casual");
  expect(battleKind(row("casual", "clanMate"))).toBe("Clanmate battle");
  expect(battleKind(row("casual", "clanMate2v2", [{}, {}]))).toBe("2v2");
  expect(battleKind(row("challenge", "challenge"))).toBe("Challenge");
  expect(battleKind(row("ladder", "PvP"))).toBeNull();
});

test("a row's result leads with the word and its tone", () => {
  const b = (outcome, crowns, against) => ({
    me: { outcome, crowns },
    opponents: [{ crowns: against }],
  });
  expect(battleOutcome(b("win", 3, 0))).toEqual({
    words: "Won 3–0",
    tone: "win",
  });
  expect(battleOutcome(b("loss", 0, 2))).toEqual({
    words: "Lost 0–2",
    tone: "loss",
  });
  expect(battleOutcome({ me: { outcome: "draw" }, opponents: [] })).toEqual({
    words: "Drew",
    tone: "draw",
  });
});

test("a day with one sitting says its record, trophies and span", () => {
  const sit = (battles, trophies) => ({
    wins: 0,
    losses: 4,
    draws: 0,
    sittings: [
      {
        start: "2026-11-03T18:09:00Z",
        end: "2026-11-03T18:44:00Z",
        trophies,
        battles,
      },
    ],
  });
  const line = soloSittingLine(
    sit([{}, {}, {}, {}], { from: 12830, to: 12712 }),
    "UTC",
  );
  expect(line).toMatch(/^0–4 · 12,830 to 12,712 · /);
  expect(line).not.toContain("battles");
  // One battle has no span to tell, and no trophies are not guessed.
  expect(soloSittingLine(sit([{}], null), "UTC")).toBe("0–4");
});
