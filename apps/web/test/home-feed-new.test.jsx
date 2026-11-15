/**
 * Home's "N new" pill (2026-11-14): an open feed is never read again under
 * the reader. A cheap count says when new items have arrived, a pill offers
 * them, and the tap reads the first page again. Your own battles landing
 * asks the count, not the feed. Invented players only.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, act, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { HomeFeed } from "../src/home/Feed.jsx";
import { HOME_FEED_NEW_KEY } from "../src/lib/queries.js";
import { useOwnRefresh } from "../src/lib/own-refresh.js";
import { feedSince } from "../src/home/logic.js";

vi.mock("../src/analytics.js", () => ({ trackEvent: () => {} }));

const AGO = (min) => new Date(Date.now() - min * 60_000).toISOString();
const page = (items) => ({
  as_of: AGO(0),
  window: { from: AGO(10_080), to: AGO(0) },
  seen_to: AGO(120),
  timeline: items,
  total: items.length,
  next: null,
  timeline_more: 0,
});
const item = (n, min, extra = {}) => ({
  id: `tl_${String(n).padStart(20, "0")}`,
  kind: "pol_league",
  at: AGO(min),
  observed_at: AGO(min),
  subject_tag: "#00JQ20",
  subject_name: `Invented ${n}`,
  subjects: [{ tag: "#00JQ20", kind: "player", name: `Invented ${n}` }],
  groups: ["friends"],
  text: `Invented ${n} reached Path of Legends.`,
  facts: {},
  ...extra,
});

let feed, fresh, calls;
beforeEach(() => {
  calls = [];
  global.fetch = vi.fn(async (path, init) => {
    const url = new URL(String(path), "https://elixir.test");
    const key = `${init?.method ?? "GET"} ${url.pathname}`;
    calls.push({ key, since: url.searchParams.get("since") });
    const body =
      key === "GET /api/me/home/feed"
        ? feed
        : key === "GET /api/me/home/feed/new"
          ? { new: fresh, built_at: AGO(1) }
          : key === "POST /api/me/refresh"
            ? { queued: false, players: [{ state: "fresh" }] }
            : key === "GET /api/me/refresh"
              ? { players: [], feed_current: true }
              : {};
    return { ok: true, text: async () => JSON.stringify(body) };
  });
});
afterEach(() => cleanup());

const count = (key) => calls.filter((c) => c.key === key).length;

test("the pill counts from the newest item shown, a sitting by its last battle", () => {
  expect(feedSince(null)).toBeNull();
  const sitting = item(1, 90, { kind: "battle_session", sort_at: AGO(5) });
  expect(feedSince(page([item(2, 30), sitting]))).toBe(sitting.sort_at);
  const empty = page([]);
  expect(feedSince(empty)).toBe(empty.window.to);
});

test("new items wait behind the pill; the tap reads the first page again", async () => {
  feed = page([item(1, 30)]);
  fresh = 0;
  const { queryClient } = renderWithProviders(<HomeFeed />);
  expect(
    await screen.findByText("Invented 1 reached Path of Legends."),
  ).toBeTruthy();
  await vi.waitFor(() => expect(count("GET /api/me/home/feed/new")).toBe(1));
  expect(calls.find((c) => c.key === "GET /api/me/home/feed/new").since).toBe(
    feed.timeline[0].at,
  );
  expect(screen.queryByRole("button", { name: /new item/ })).toBeNull();

  // Two items arrive: the count says so and nothing in the feed moves.
  feed = page([item(3, 1), item(2, 2), item(1, 30)]);
  fresh = 2;
  await act(() => queryClient.refetchQueries({ queryKey: HOME_FEED_NEW_KEY }));
  const pill = await screen.findByRole("button", {
    name: "Show 2 new items",
  });
  expect(pill.textContent).toBe("2 new");
  expect(count("GET /api/me/home/feed")).toBe(1);
  expect(screen.queryByText("Invented 3 reached Path of Legends.")).toBeNull();

  fresh = 0;
  fireEvent.click(pill);
  expect(
    await screen.findByText("Invented 3 reached Path of Legends."),
  ).toBeTruthy();
  expect(count("GET /api/me/home/feed")).toBe(2);
  await vi.waitFor(() =>
    expect(screen.queryByRole("button", { name: /new item/ })).toBeNull(),
  );
});

function Ask() {
  const { ask } = useOwnRefresh();
  return (
    <button type="button" onClick={ask}>
      Ask
    </button>
  );
}

test("your own battles landing asks the count, never the open feed", async () => {
  feed = page([item(1, 30)]);
  fresh = 0;
  renderWithProviders(
    <>
      <Ask />
      <HomeFeed />
    </>,
  );
  expect(
    await screen.findByText("Invented 1 reached Path of Legends."),
  ).toBeTruthy();
  await vi.waitFor(() => expect(count("GET /api/me/home/feed/new")).toBe(1));
  fresh = 1;
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  expect(
    await screen.findByRole("button", { name: "Show 1 new item" }),
  ).toBeTruthy();
  expect(count("GET /api/me/home/feed")).toBe(1);
});
