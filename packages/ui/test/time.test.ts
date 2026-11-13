import { describe, expect, it } from "vitest";
import {
  calendarDay,
  clockAt,
  dayAt,
  feedDayHeadingAt,
  feedWhenAt,
  monthDayAt,
  seasonWeek,
  whenAt,
} from "../src/time.ts";

// A Saturday evening on a reader's clock in Central time.
const NOW = Date.parse("2026-11-08T02:42:00Z"); // Sat Nov 7, 8:42 pm CST
const CENTRAL = "America/Chicago";
const DAY = 86_400_000;

describe("whenAt", () => {
  it("names only the weekday within a week", () => {
    expect(whenAt(NOW, CENTRAL, { now: NOW })).toBe("Sat 8:42 pm");
    expect(whenAt(NOW - 6 * DAY, CENTRAL, { now: NOW })).toBe("Sun 8:42 pm");
  });

  it("gives the date from a week back on", () => {
    expect(whenAt(NOW - 7 * DAY + 60_000, CENTRAL, { now: NOW })).toBe(
      "Sat 9:43 pm",
    );
    expect(whenAt(NOW - 7 * DAY, CENTRAL, { now: NOW })).toBe(
      "Sat Oct 31, 9:42 pm",
    );
  });

  it("reads older dates with the month, and another year with the year", () => {
    expect(whenAt("2026-10-23T22:07:00Z", CENTRAL, { now: NOW })).toBe(
      "Fri Oct 23, 5:07 pm",
    );
    expect(whenAt("2025-10-23T22:07:00Z", CENTRAL, { now: NOW })).toBe(
      "Thu Oct 23 2025, 5:07 pm",
    );
  });

  it("reads in the zone, so the day can differ from UTC's", () => {
    const at = "2026-10-24T03:30:00Z";
    expect(whenAt(at, CENTRAL, { now: NOW })).toBe("Fri Oct 23, 10:30 pm");
    expect(whenAt(at, "Asia/Tokyo", { now: NOW })).toBe("Sat Oct 24, 12:30 pm");
  });

  it("is UTC, and says so, with no zone or one it cannot read", () => {
    const at = "2026-10-23T22:07:00Z";
    expect(whenAt(at, null, { now: NOW })).toBe("Fri Oct 23, 10:07 pm UTC");
    expect(whenAt(at, "UTC", { now: NOW })).toBe("Fri Oct 23, 10:07 pm UTC");
    expect(whenAt(at, "Not/AZone", { now: NOW })).toBe(
      "Fri Oct 23, 10:07 pm UTC",
    );
  });

  it("says nothing of an instant it does not have", () => {
    expect(whenAt(null, CENTRAL, { now: NOW })).toBe("—");
    expect(whenAt("not a time", CENTRAL, { now: NOW })).toBe("—");
  });

  it("keeps the whole date when nothing is read against now", () => {
    expect(whenAt("2026-09-03T14:11:00Z", null, { now: 0 })).toBe(
      "Thu Sep 3 2026, 2:11 pm UTC",
    );
  });
});

describe("the day alone", () => {
  it("dayAt is the reader's day", () => {
    expect(dayAt("2026-10-24T03:30:00Z", CENTRAL, { now: NOW })).toBe(
      "Fri Oct 23",
    );
    expect(dayAt("2025-10-24T15:00:00Z", CENTRAL, { now: NOW })).toBe(
      "Fri Oct 24 2025",
    );
  });

  it("no zone moves a bare date", () => {
    expect(dayAt("2026-10-23", CENTRAL, { now: NOW })).toBe("Fri Oct 23");
    expect(dayAt("2026-10-23", "Asia/Tokyo", { now: NOW })).toBe("Fri Oct 23");
    expect(calendarDay("2026-10-23", { now: NOW })).toBe("Fri Oct 23");
    expect(calendarDay("2026-11-10T00:00:00.000Z", { now: NOW })).toBe(
      "Tue Nov 10",
    );
    expect(calendarDay(null, { now: NOW })).toBe("—");
  });

  it("clockAt and monthDayAt read on the reader's clock", () => {
    expect(clockAt("2026-10-24T03:30:00Z", CENTRAL)).toBe("10:30 pm");
    expect(monthDayAt("2026-10-24T03:30:00Z", CENTRAL)).toBe("Oct 23");
    expect(clockAt(null, CENTRAL)).toBe("");
  });
});

describe("seasonWeek", () => {
  it("writes a week in words", () => {
    expect(seasonWeek(137, 4)).toBe("Season 137, week 4");
    expect(seasonWeek(137)).toBe("Season 137");
  });
});

describe("the feed's words (design canvas, 2026-11-13)", () => {
  const Z = "America/Chicago";
  // Thursday 2026-11-12, 9:00 pm in Chicago.
  const now = Date.parse("2026-11-13T03:00:00Z");
  it("says today, tonight, yesterday, a weekday, then a date", () => {
    expect(feedWhenAt("2026-11-12T22:10:00Z", Z, { now })).toBe(
      "Today, 4:10 pm",
    );
    expect(feedWhenAt("2026-11-13T02:14:00Z", Z, { now })).toBe(
      "Tonight, 8:14 pm",
    );
    expect(feedWhenAt("2026-11-12T01:55:00Z", Z, { now })).toBe(
      "Yesterday, 7:55 pm",
    );
    expect(feedWhenAt("2026-11-09T15:30:00Z", Z, { now })).toBe(
      "Monday, 9:30 am",
    );
    expect(feedWhenAt("2026-11-05T15:30:00Z", Z, { now })).toBe(
      "Thursday, November 5, 9:30 am",
    );
    expect(feedWhenAt("2025-11-05T15:30:00Z", Z, { now })).toBe(
      "Wednesday, November 5, 2025, 9:30 am",
    );
  });
  it("says both days for a sitting across midnight (Codex on #864)", () => {
    expect(
      feedWhenAt("2026-11-12T05:50:00Z", Z, {
        now,
        end: "2026-11-12T06:10:00Z",
      }),
    ).toBe("Yesterday, 11:50 pm to today, 12:10 am");
    expect(
      feedWhenAt("2026-11-09T05:50:00Z", Z, {
        now,
        end: "2026-11-09T06:10:00Z",
      }),
    ).toBe("Sunday, 11:50 pm to Monday, 12:10 am");
  });
  it("gives a sitting its range, the am or pm said once when shared", () => {
    expect(
      feedWhenAt("2026-11-13T01:40:00Z", Z, {
        now,
        end: "2026-11-13T02:32:00Z",
      }),
    ).toBe("Tonight, 7:40 to 8:32 pm");
    expect(
      feedWhenAt("2026-11-12T17:40:00Z", Z, {
        now,
        end: "2026-11-12T18:20:00Z",
      }),
    ).toBe("Today, 11:40 am to 12:20 pm");
    expect(
      feedWhenAt("2026-11-12T17:40:00Z", Z, {
        now,
        end: "2026-11-12T17:40:30Z",
      }),
    ).toBe("Today, 11:40 am");
  });
  it("says UTC when the reader has no zone", () => {
    expect(feedWhenAt("2026-11-12T22:10:00Z", null, { now })).toBe(
      "Yesterday, 10:10 pm UTC",
    );
  });
  it("heads a day as Today, Yesterday, then its date", () => {
    expect(feedDayHeadingAt("2026-11-12T22:10:00Z", Z, { now })).toBe("Today");
    expect(feedDayHeadingAt("2026-11-12T01:55:00Z", Z, { now })).toBe(
      "Yesterday",
    );
    expect(feedDayHeadingAt("2026-11-09T15:30:00Z", Z, { now })).toBe(
      "Monday, November 9",
    );
  });
});
