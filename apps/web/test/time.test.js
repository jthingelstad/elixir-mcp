import { test, expect } from "vitest";
import { ago, agoExact } from "../src/lib/time.js";

const at = (secondsAgo) =>
  new Date(1_000_000_000_000 - secondsAgo * 1000).toISOString();
const NOW = 1_000_000_000_000;

// The fleet table reads rows against each other: "3m ago" five times
// over hid that the collectors were fetching in lockstep.
test("agoExact keeps the seconds where ago rounds them away", () => {
  expect(ago(at(192), NOW)).toBe("3m ago");
  expect(agoExact(at(192), NOW)).toBe("3m 12s ago");
  expect(agoExact(at(12), NOW)).toBe("12s ago");
  expect(agoExact(at(0), NOW)).toBe("0s ago");
  expect(agoExact(at(3600 * 2 + 60 * 14 + 9), NOW)).toBe("2h 14m ago");
  expect(agoExact(at(86400 * 3 + 3600 * 5 + 7), NOW)).toBe("3d 5h ago");
  expect(agoExact(null, NOW)).toBe("never");
  // A browser clock a second behind the server never reads negative.
  expect(agoExact(at(-2), NOW)).toBe("0s ago");
});
