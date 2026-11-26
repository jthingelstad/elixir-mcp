import { expect, test } from "vitest";
import { eventDetail, eventLabel } from "../src/views/account/events.js";

test("an email choice reads as what changed, in the page's words", () => {
  expect(eventLabel("email_pref")).toBe("Email choice changed");
  expect(
    eventDetail({
      kind: "email_pref",
      detail: { kind: "clan_report", enabled: false, label: "Clan report" },
    }),
  ).toBe("Clan report: off");
  expect(
    eventDetail({
      kind: "email_pref",
      detail: { kind: "all", enabled: true, label: "every Elixir email" },
    }),
  ).toBe("Every Elixir email: on");
  expect(
    eventDetail({
      kind: "email_pref",
      detail: { kind: "digest_daily", enabled: true, label: "Daily brief" },
    }),
  ).toBe("Daily brief: on");
  // A how-often choice from before the three emails (2026-11-26) still
  // reads as what it was.
  expect(
    eventDetail({
      kind: "email_pref",
      detail: {
        kind: "tracking_report",
        cadence: "daily",
        label: "Weekly recap",
      },
    }),
  ).toBe("Digest: daily");
});

test("a kind nobody named reads as its own words", () => {
  expect(eventLabel("something_new")).toBe("Something new");
});
