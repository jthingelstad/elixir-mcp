/**
 * Home's "N new" pill (2026-11-14): an open feed is never read again under
 * the reader. A cheap count says when new items have arrived, a pill offers
 * them, and the tap reads the first page again. Your own battles landing
 * after the app asked on its own asks the count, not the feed; after you
 * asked, the feed is read again. Invented players only.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, act, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { HomeFeed } from "../src/home/Feed.jsx";
import { HOME_FEED_NEW_KEY } from "../src/lib/queries.js";
import { useState } from "react";
import { useOwnRefresh, useRefreshOnOpen } from "../src/lib/own-refresh.js";
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
// One clock read per item: `at` and `observed_at` are the same instant,
// or a millisecond between two reads makes the pill count from the later.
const item = (n, min, extra = {}, when = AGO(min)) => ({
  id: `tl_${String(n).padStart(20, "0")}`,
  kind: "pol_league",
  at: when,
  observed_at: when,
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
    calls.push({
      key,
      since: url.searchParams.get("since"),
      questions: url.searchParams.get("questions"),
    });
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

test("the pill counts from the newest change: a sitting by its last battle, a late battle by when it was learned", () => {
  expect(feedSince(null)).toBeNull();
  const sitting = item(1, 90, { kind: "battle_session", sort_at: AGO(5) });
  expect(feedSince(page([item(2, 30), sitting]))).toBe(sitting.sort_at);
  // Learned late: below the top by its battle, the newest by learning.
  const late = item(3, 60, { observed_at: AGO(1) });
  expect(feedSince(page([item(2, 30), late]))).toBe(late.observed_at);
  // The server's watermark wins: it has seen the whole week.
  expect(
    feedSince({
      ...page([item(2, 30)]),
      watermark: "2026-11-14T12:00:00.000Z",
    }),
  ).toBe("2026-11-14T12:00:00.000Z");
  const empty = page([]);
  expect(feedSince(empty)).toBe(empty.window.to);
});

test("the poll fallback ignores post edits while retaining newly learned game items", () => {
  const post = item(1, 180, { kind: "post", observed_at: AGO(1) });
  const game = item(2, 30);
  expect(feedSince(page([game, post]))).toBe(game.at);
});

test("an edited post agrees with New zero and has no new-row marker", async () => {
  const text = "Reworded after the previous visit";
  const post = item(1, 180, {
    kind: "post",
    observed_at: AGO(1),
    text,
    post: {
      id: "7",
      text,
      question: true,
      deck: null,
      cards: [],
      author: { name: "Invented Ada", player_tag: "#00JQ20" },
    },
  });
  feed = page([post]);
  feed.counts = { new: 0, new_since: feed.seen_to };
  fresh = 0;
  renderWithProviders(<HomeFeed />);
  expect(await screen.findByText(text)).toBeTruthy();
  expect(screen.queryByText("New since your last visit")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "New since your last visit: 0" }),
  );
  expect(screen.queryByText(text)).toBeNull();
  expect(
    screen.getByText("Nothing new here since your last visit."),
  ).toBeTruthy();
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

const ME = {
  authenticated: true,
  claims: [{ claim_status: "verified", is_primary: true }],
};
function OnOpen() {
  useRefreshOnOpen(ME);
  return null;
}
/** The app opening, a moment after Home has drawn. */
function OnOpenAfter() {
  const [open, setOpen] = useState(false);
  return open ? (
    <OnOpen />
  ) : (
    <button type="button" onClick={() => setOpen(true)}>
      Open
    </button>
  );
}

// A friend's item five minutes old tops the feed; your own refresh then
// records a battle ten minutes old. It is older than the top, and it must
// still reach you.
const friend = () => item(1, 5);
const yours = () =>
  item(2, 10, {
    text: "Invented 2 won a battle.",
    observed_at: AGO(0),
  });

test("the app's own ask lands: the open feed is not read, the pill offers the late battle", async () => {
  feed = page([friend()]);
  fresh = 0;
  renderWithProviders(
    <>
      <OnOpenAfter />
      <HomeFeed />
    </>,
  );
  expect(
    await screen.findByText("Invented 1 reached Path of Legends."),
  ).toBeTruthy();
  await vi.waitFor(() => expect(count("GET /api/me/home/feed/new")).toBe(1));
  feed = page([friend(), yours()]);
  fresh = 1;
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  const pill = await screen.findByRole("button", { name: "Show 1 new item" });
  expect(count("GET /api/me/home/feed")).toBe(1);
  expect(screen.queryByText("Invented 2 won a battle.")).toBeNull();
  fresh = 0;
  fireEvent.click(pill);
  expect(await screen.findByText("Invented 2 won a battle.")).toBeTruthy();
});

test("you asked (the chip or the button): the feed is read again and your battle shows", async () => {
  feed = page([friend()]);
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
  feed = page([friend(), yours()]);
  fresh = 1;
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  expect(await screen.findByText("Invented 2 won a battle.")).toBeTruthy();
  expect(count("GET /api/me/home/feed")).toBe(2);
});

test("Questions polls use their own source and cache and return to Everyone's poll", async () => {
  const originalFetch = global.fetch;
  global.fetch = vi.fn(async (path, init) => {
    const url = new URL(String(path), "https://elixir.test");
    if (url.pathname === "/api/me")
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            authenticated: true,
            features: { posts: true, comments: true },
          }),
      };
    return originalFetch(path, init);
  });
  feed = page([
    item(1, 30, {
      kind: "post",
      post: {
        id: "7",
        text: "An old question",
        question: true,
        author: { name: "Invented Ada", player_tag: "#00JQ20" },
      },
    }),
  ]);
  fresh = 0;
  renderWithProviders(<HomeFeed />);
  const questions = await screen.findByRole("button", {
    name: "Questions",
    exact: true,
  });
  await vi.waitFor(() => expect(count("GET /api/me/home/feed/new")).toBe(1));
  fireEvent.click(questions);
  await vi.waitFor(() =>
    expect(
      calls.filter(
        (c) => c.key === "GET /api/me/home/feed/new" && c.questions === "1",
      ),
    ).toHaveLength(1),
  );
  expect(
    calls.filter((c) => c.key === "GET /api/me/home/feed/new"),
  ).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: /^Everyone/ }));
  expect(screen.queryByRole("button", { name: /Show .* new/ })).toBeNull();
});

test("an empty Questions view offers its first arriving question through the New pill", async () => {
  const originalFetch = global.fetch;
  let questionFeed = { ...page([]), watermark: AGO(10_080) };
  global.fetch = vi.fn(async (path, init) => {
    const url = new URL(String(path), "https://elixir.test");
    if (url.pathname === "/api/me")
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            authenticated: true,
            features: { posts: true, comments: true },
          }),
      };
    const result = await originalFetch(path, init);
    return url.pathname === "/api/me/home/feed" &&
      url.searchParams.get("questions") === "1"
      ? { ok: true, text: async () => JSON.stringify(questionFeed) }
      : result;
  });
  feed = page([friend()]);
  fresh = 0;
  const { queryClient } = renderWithProviders(<HomeFeed />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Questions", exact: true }),
  );
  await screen.findByRole("heading", {
    name: "No questions in the last seven days",
  });
  await vi.waitFor(() =>
    expect(
      calls.filter(
        (c) => c.key === "GET /api/me/home/feed/new" && c.questions === "1",
      ),
    ).toHaveLength(1),
  );
  const arriving = item(7, 1, {
    kind: "post",
    post: {
      id: "8",
      text: "The first new question",
      question: true,
      author: { name: "Invented Ada", player_tag: "#00JQ20" },
    },
  });
  questionFeed = { ...page([arriving]), watermark: arriving.at };
  fresh = 1;
  await act(() => queryClient.refetchQueries({ queryKey: HOME_FEED_NEW_KEY }));
  const pill = await screen.findByRole("button", {
    name: "Show 1 new item",
    exact: true,
  });
  expect(screen.queryByText("The first new question")).toBeNull();
  fresh = 0;
  fireEvent.click(pill);
  expect(await screen.findByText("The first new question")).toBeTruthy();
  await vi.waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Show 1 new item", exact: true }),
    ).toBeNull(),
  );
});
