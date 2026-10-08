import { test, expect } from "vitest";
import { recordJourney } from "../src/lib/record-journey.js";

const player = {
  player_tag: "#P0Y",
  recording_status: "active",
  battles_30d: 0,
};
const journey = (p) =>
  recordJourney({ player: { ...player, ...p }, as_of: "2026-10-06T12:00:00Z" });

test("saved tags stay pending; profiles and older battles have destinations that actually hold them", () => {
  expect(journey({}).state).toBe("Capture pending");
  expect(journey({}).text).toContain("usually lands within a few minutes");
  expect(journey({}).text).toContain("last 30 battles");
  expect(journey({ profile_available: true }).to).toBe(
    "/console/explore/profile/P0Y",
  );
  const old = journey({
    recording_status: "stopped",
    last_battle_at: "2026-07-01T00:00:00Z",
  });
  expect(old.state).toBe("Recording stopped");
  expect(old.to).toBe("/console/explore/list/battles:P0Y");
  expect(old.text).toContain("retained record");
});

test("a newer failed attempt is independent from retained facts and each endpoint's successful admission", () => {
  const attempts = [
    {
      endpoint: "player",
      last_failed_at: "2026-10-06T11:00:00Z",
      last_admitted_at: "2026-10-06T10:00:00Z",
    },
  ];
  expect(
    journey({ capture_attempts: attempts, profile_available: true }).state,
  ).toBe("Capture attempt failed");
  expect(
    journey({ capture_attempts: attempts, profile_available: true }).to,
  ).toContain("/profile/");
  expect(
    journey({
      capture_attempts: [
        { ...attempts[0], last_admitted_at: "2026-10-06T11:01:00Z" },
      ],
    }).state,
  ).toBe("Capture pending");
  expect(
    journey({
      capture_attempts: [
        { ...attempts[0], last_failed_at: "2026-10-07T00:00:00Z" },
      ],
    }).failedAt,
  ).toBeUndefined();
});

test("partial measured evidence stays bounded and complete intervals do not claim whole-history completeness", () => {
  expect(
    journey({
      capture_interval: {
        ratio: 0.5,
        expected_battles: 4,
        captured_battles: 2,
      },
    }).partial.expected_battles,
  ).toBe(4);
  expect(
    journey({ capture_interval: { ratio: 1 }, battles_30d: 2 }).partial,
  ).toBeNull();
  expect(journey({ battles_30d: 2 }).text).toContain(
    "unobserved time remain unknown",
  );
  expect(journey({ recording_status: null }).state).toBe(
    "Recording status unknown",
  );
});

test("a 404 on the profile, before anything was captured, says the tag was not found", () => {
  const missing = [
    {
      endpoint: "player",
      last_failed_at: "2026-10-06T11:00:00Z",
      last_failed_status: 404,
    },
  ];
  const j = journey({ capture_attempts: missing });
  expect(j.state).toBe("Tag not found");
  expect(j.notFound).toBe(true);
  expect(j.text).toContain("We couldn't find #P0Y in Clash Royale");
  expect(j.to).toBe("/console/account/tracking/P0Y");
  // Any other failure is only a failed attempt; so is a 404 on a player
  // the record already holds, or on the battle log alone.
  expect(
    journey({
      capture_attempts: [{ ...missing[0], last_failed_status: 503 }],
    }).state,
  ).toBe("Capture attempt failed");
  expect(
    journey({ capture_attempts: missing, profile_available: true }).state,
  ).toBe("Capture attempt failed");
  expect(
    journey({
      capture_attempts: [{ ...missing[0], endpoint: "player_battlelog" }],
    }).state,
  ).toBe("Capture attempt failed");
});
