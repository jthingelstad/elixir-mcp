/**
 * Home's first read polls only while the player's own battle log is unread
 * (2026-11-09): every 5 s while the add is fresh, the first-answer read and
 * nothing else, then Home's reads once when the log lands. A player whose log
 * has been read is never polled.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, act } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { useFirstRead } from "../src/home/first-read.js";

vi.mock("../src/analytics.js", () => ({ trackEvent: () => {} }));

function Home({ first }) {
  const read = useFirstRead(first);
  return <p>{read.ready ? "Today" : "Steps"}</p>;
}

const READ = "2026-11-09T01:56:27Z";
let status;
let calls;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  Object.defineProperty(document, "visibilityState", {
    value: "visible",
    configurable: true,
  });
  calls = [];
  global.fetch = vi.fn(async (path) => {
    calls.push(String(path).split("?")[0]);
    return {
      ok: true,
      text: async () =>
        JSON.stringify({
          as_of: new Date().toISOString(),
          player: status,
          connection: { active_connections: 0 },
          clan: null,
        }),
    };
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

test("a stub with no log read keeps polling, then refreshes Home once when the read lands", async () => {
  const stub = {
    player_tag: "#220UUJ2YRU",
    recording_status: "active",
    tracked_since: new Date().toISOString(),
    profile_available: false,
    battlelog_observed_at: null,
    last_battle_at: "2026-11-02T18:00:00Z",
    battles_30d: 1,
    capture_attempts: [],
  };
  status = stub;
  const { queryClient } = renderWithProviders(
    <Home
      first={{ ok: true, as_of: new Date().toISOString(), player: stub }}
    />,
  );
  const invalidated = vi.spyOn(queryClient, "invalidateQueries");
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByText("Steps")).toBeTruthy();
  const first = calls.filter((c) => c === "/api/me/first-answer").length;
  expect(first).toBe(1);
  // The profile lands: still waiting, still polling every 5 s.
  status = { ...stub, profile_available: true };
  await act(() => vi.advanceTimersByTimeAsync(5_000));
  expect(screen.getByText("Steps")).toBeTruthy();
  // The battle log lands.
  status = { ...status, battlelog_observed_at: READ, battles_30d: 6 };
  await act(() => vi.advanceTimersByTimeAsync(5_000));
  expect(screen.getByText("Today")).toBeTruthy();
  expect(
    invalidated.mock.calls.filter(
      ([q]) => JSON.stringify(q?.queryKey) === '["me","home"]',
    ),
  ).toHaveLength(1);
  // Nothing polls once the log is read.
  const settled = calls.length;
  await act(() => vi.advanceTimersByTimeAsync(120_000));
  expect(calls.length).toBe(settled);
  expect(new Set(calls)).toEqual(new Set(["/api/me/first-answer"]));
});

test("a player whose log has been read is never polled", async () => {
  status = null;
  renderWithProviders(
    <Home
      first={{
        ok: true,
        as_of: new Date().toISOString(),
        player: {
          player_tag: "#20JJJ2CCRU",
          recording_status: "active",
          tracked_since: new Date().toISOString(),
          profile_available: true,
          battlelog_observed_at: READ,
          battles_30d: 30,
        },
      }}
    />,
  );
  await act(() => vi.advanceTimersByTimeAsync(300_000));
  expect(screen.getByText("Today")).toBeTruthy();
  expect(calls).toEqual([]);
});

test("a log read that lands before the profile keeps taking status reads, then refreshes Home once", async () => {
  const empty = {
    player_tag: "#2PYQ0LUC8",
    recording_status: "active",
    tracked_since: new Date().toISOString(),
    profile_available: false,
    battlelog_observed_at: READ,
    last_battle_at: null,
    battles_30d: 0,
    capture_attempts: [],
  };
  status = empty;
  const { queryClient } = renderWithProviders(
    <Home
      first={{ ok: true, as_of: new Date().toISOString(), player: empty }}
    />,
  );
  const invalidated = vi.spyOn(queryClient, "invalidateQueries");
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByText("Steps")).toBeTruthy();
  expect(calls).toEqual(["/api/me/first-answer"]);
  // The profile lands after the log: the next status read draws Today.
  status = { ...empty, profile_available: true };
  await act(() => vi.advanceTimersByTimeAsync(5_000));
  expect(screen.getByText("Today")).toBeTruthy();
  await act(() => vi.advanceTimersByTimeAsync(10_000));
  expect(
    invalidated.mock.calls.filter(
      ([q]) => JSON.stringify(q?.queryKey) === '["me","home"]',
    ),
  ).toHaveLength(1);
});
