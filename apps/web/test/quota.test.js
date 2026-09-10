import { test, expect } from "vitest";
import { quotaReading } from "../src/lib/quota.js";

// One reading for two pages: Usage and Settings used to derive the
// ceiling separately, with a fallback that could disagree.
test("a limit reads as used-of-limit with a percentage and a full mark", () => {
  const q = quotaReading({
    today_calls: 1646,
    quota_max: 5000,
    live_today: 50,
    live_max: 50,
  });
  expect(q.calls.label).toBe("1,646 of 5,000");
  expect(q.calls.pct).toBe(33);
  expect(q.calls.full).toBe(false);
  expect(q.fetches.full).toBe(true);
  expect(q.fetches.pct).toBe(100);
  expect(q.resets).toMatch(/^resets 00:00Z · \d+h \d{2}m$/);
});

test("an unlimited ceiling is infinity, never full", () => {
  const q = quotaReading({ today_calls: 9000, quota_max: null });
  expect(q.calls.label).toBe("9,000 of ∞");
  expect(q.calls.full).toBe(false);
  expect(q.calls.pct).toBe(0);
});
