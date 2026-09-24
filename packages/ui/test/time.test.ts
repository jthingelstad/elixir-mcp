import { test, expect } from "vitest";
import {
  ago,
  agoExact,
  agoSeconds,
  freshCls,
  stamp,
  stampDay,
  stampTime,
} from "../src/index.ts";

const NOW = Date.parse("2026-09-12T18:00:00Z");
const at = (s: number) => new Date(NOW - s * 1000).toISOString();

test("one coarse vocabulary: the unit turns over late", () => {
  expect(agoSeconds(0.4)).toBe("just now");
  expect(agoSeconds(12)).toBe("12s ago");
  expect(agoSeconds(75)).toBe("75s ago");
  expect(agoSeconds(192)).toBe("3m ago");
  expect(agoSeconds(3600)).toBe("60m ago");
  expect(agoSeconds(5400)).toBe("2h ago");
  expect(agoSeconds(86400)).toBe("24h ago");
  expect(agoSeconds(172800)).toBe("2d ago");
  expect(agoSeconds(null)).toBe("never");
  expect(ago(at(3600), NOW)).toBe("60m ago");
  expect(ago(null, NOW)).toBe("never");
  // The clocks disagree by a second: never negative.
  expect(ago(at(-2), NOW)).toBe("just now");
});

test("agoExact keeps the seconds where ago rounds them away", () => {
  expect(agoExact(at(192), NOW)).toBe("3m 12s ago");
  expect(agoExact(at(3600 * 2 + 60 * 14 + 9), NOW)).toBe("2h 14m ago");
});

test("freshness classes", () => {
  expect(freshCls(10)).toBe("freshness freshness--live");
  expect(freshCls(1000)).toBe("freshness freshness--stale");
  expect(freshCls(90000)).toBe("freshness");
  expect(freshCls(null)).toBe("freshness freshness--never");
});

// Jamie, 2026-09-23: the console knew the account's zone and printed UTC.
test("stamps: no zone is UTC with a Z, a zone is that zone's own clock", () => {
  const t = "2026-09-13T02:30:05Z";
  expect(stamp(t)).toBe("09-13 02:30Z");
  expect(stamp(t, null, { year: true, seconds: true })).toBe(
    "2026-09-13 02:30:05Z",
  );
  expect(stamp(t, "UTC")).toBe("09-13 02:30Z");
  // Chicago is five hours behind in September, and on the day before.
  expect(stamp(t, "America/Chicago")).toBe("09-12 21:30 CDT");
  expect(stampDay(t, "America/Chicago")).toBe("2026-09-12");
  expect(stampDay(t)).toBe("2026-09-13");
  expect(stampTime(t, "America/Chicago", { seconds: true })).toBe(
    "21:30:05 CDT",
  );
  expect(stampTime(t, "America/Chicago", { bare: true })).toBe("21:30");
  // Standard time is named as such, not as the summer abbreviation.
  expect(stamp("2026-01-15T18:00:00Z", "America/Chicago")).toBe(
    "01-15 12:00 CST",
  );
  // A zone the browser does not know reads as UTC rather than failing.
  expect(stamp(t, "Not/AZone")).toBe("09-13 02:30Z");
  expect(stamp(null, "America/Chicago")).toBe("—");
  expect(stamp("not a date")).toBe("—");
  expect(stampDay(undefined)).toBe("—");
});
