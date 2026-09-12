/**
 * Verify: the deck-slot wizard. The picker lists the account's players,
 * a start shows the eight-card brief, the live half polls every 15 s and
 * lights matched cards up one by one, and the unlock says to switch the
 * deck back. Reduced motion gets the badge without the sparks.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
  act,
} from "@testing-library/react";
import { App } from "../src/App.jsx";

const ME = {
  authenticated: true,
  is_admin: false,
  is_owner: false,
  role: "member",
  email: "jamie@example.com",
  timezone: "America/Chicago",
  claims: [
    {
      player_tag: "#2PP0V90Y",
      name: "King Thing",
      status: "unverified",
      is_primary: true,
    },
  ],
  recordings: [],
  entitlements: {},
};
const card = (i, matched = false) => ({
  id: 26000000 + i,
  name: `Card ${i}`,
  icon: `https://api-assets.clashroyale.com/cards/300/${i}.png`,
  matched,
});
const OPEN = {
  state: "open",
  challenge_id: "11111111-1111-1111-1111-111111111111",
  player_tag: "#2PP0V90Y",
  name: "King Thing",
  created_at: "2026-09-12T14:00:00Z",
  expires_at: new Date(Date.now() + 19 * 60_000).toISOString(),
  target: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => card(i)),
  battles_since: 0,
  last_battle: null,
  read_at: null,
  matched: 0,
  of: 8,
  live_pending: true,
  retry_after_s: 15,
};
const battle = (cards, outcome, proof = false) => ({
  battle_id: `b-${outcome}`,
  battle_time: "2026-09-12T14:01:30Z",
  type: "pathOfLegend",
  mode: "Path of Legends",
  outcome,
  crowns: outcome === "win" ? 3 : 1,
  opponent: {
    player_tag: "#RIVAL",
    name: "Rival",
    crowns: outcome === "win" ? 1 : 3,
  },
  cards,
  proof,
});
const PARTIAL = {
  ...OPEN,
  target: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => card(i, i <= 3)),
  battles_since: 1,
  last_battle: battle(
    [1, 2, 3, 20, 21, 22, 23, 24].map((i) => card(i, i <= 3)),
    "loss",
  ),
  read_at: "2026-09-12T14:01:30Z",
  matched: 3,
  live_pending: false,
};
const VERIFIED = {
  ...PARTIAL,
  state: "verified",
  target: PARTIAL.target.map((c) => ({ ...c, matched: true })),
  battles_since: 2,
  last_battle: battle(
    PARTIAL.target.map((c) => ({ ...c, matched: true })),
    "win",
    true,
  ),
  matched: 8,
  verified_at: "2026-09-12T14:02:10Z",
  seen_after_s: 28,
};

let statusQueue;
let posts;
function mockFetch() {
  global.fetch = vi.fn(async (path, init) => {
    const p = String(path);
    const method = init?.method ?? "GET";
    let body = {};
    const status = 200;
    if (p === "/api/me") body = ME;
    else if (p === "/api/me/verify" && method === "GET")
      body = {
        players: [
          {
            player_tag: "#2PP0V90Y",
            name: "King Thing",
            status: "unverified",
            verified_at: null,
            is_primary: true,
            relationship: "primary",
            eligible: true,
            challenge: null,
          },
          {
            player_tag: "#FRIEND01",
            name: "A Friend",
            status: "unverified",
            verified_at: null,
            is_primary: false,
            relationship: "friend",
            eligible: false,
            challenge: null,
          },
          {
            player_tag: "#ALT00001",
            name: "My Alt",
            status: "verified",
            verified_at: "2026-09-11T10:00:00Z",
            is_primary: false,
            relationship: "alt",
            eligible: true,
            challenge: null,
          },
        ],
        poll_every_s: 15,
        challenge_minutes: 20,
      };
    else if (p === "/api/me/verify" && method === "POST") {
      posts.push(JSON.parse(init.body));
      body = OPEN;
    } else if (p.startsWith("/api/me/verify/"))
      body = statusQueue.shift() ?? VERIFIED;
    return {
      ok: status < 400,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
}

beforeEach(() => {
  cleanup();
  posts = [];
  statusQueue = [PARTIAL, VERIFIED];
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("matchMedia", (q) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
  mockFetch();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("the picker lists the account's players and a start shows the eight-card brief", async () => {
  window.history.pushState({}, "", "/account/verify");
  render(<App />);
  await waitFor(() => screen.getByRole("heading", { name: "Verify" }));
  await waitFor(() => screen.getByText("King Thing"));
  // A friend is not listed at all; a verified alt carries the mark and no button.
  expect(screen.queryByText("A Friend")).toBeNull();
  expect(screen.getByText("My Alt")).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Verify" }).length).toBe(1);
  expect(screen.getAllByLabelText("Verified").length).toBeGreaterThanOrEqual(1);
  fireEvent.click(screen.getByRole("button", { name: "Verify" }));
  await waitFor(() =>
    screen.getByRole("heading", { name: "Play one battle with this deck" }),
  );
  expect(posts).toEqual([{ player_tag: "#2PP0V90Y" }]);
  const target = screen.getByRole("list", { name: "The deck to play" });
  expect(target.querySelectorAll(".deck__slot").length).toBe(8);
  expect(target.querySelectorAll("img").length).toBe(8);
  // No battle yet: eight empty slots on the live side.
  const seen = screen.getByRole("list", {
    name: "The deck in your latest battle",
  });
  expect(seen.querySelectorAll(".deck__slot--empty").length).toBe(8);
  expect(screen.getByRole("status").textContent).toMatch(
    /No battle since you started/,
  );
  expect(screen.getByText(/19 min left/)).toBeTruthy();
});

test("the live half polls every 15 s, lights matched cards up, then unlocks and says to switch back", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  window.history.pushState({}, "", "/account/verify");
  render(<App />);
  await waitFor(() => screen.getByText("King Thing"));
  fireEvent.click(screen.getByRole("button", { name: "Verify" }));
  await waitFor(() =>
    screen.getByRole("heading", { name: "Play one battle with this deck" }),
  );

  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_100);
  });
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toMatch(
      /3 of 8 in that deck · Loss 1-3 vs Rival · Path of Legends/,
    ),
  );
  const target = screen.getByRole("list", { name: "The deck to play" });
  expect(target.querySelectorAll(".deck__slot--matched").length).toBe(3);
  expect(screen.getByRole("status").textContent).toMatch(
    /log read \d\d:\d\d:\d\d/,
  );

  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_100);
  });
  await waitFor(() => screen.getByText(/switch your deck back now/));
  expect(screen.getByRole("status").textContent).toMatch(/Verified/);
  expect(screen.getByText(/The proof: Win 3-1 vs Rival/)).toBeTruthy();
  expect(screen.getByText(/28 seconds/)).toBeTruthy();
  expect(document.querySelectorAll(".verify__spark").length).toBe(12);
  // The unlock lands on the same page: the brief and the proving battle
  // stay, with all eight lit, and the timer is gone.
  expect(
    screen.getByRole("heading", { name: "Play one battle with this deck" }),
  ).toBeTruthy();
  const lit = screen.getByRole("list", { name: "The deck to play" });
  expect(lit.querySelectorAll(".deck__slot--matched").length).toBe(8);
  expect(screen.queryByText(/min left/)).toBeNull();
  // The poll stops once verified: no further status reads.
  const before = global.fetch.mock.calls.filter((c) =>
    String(c[0]).startsWith("/api/me/verify/"),
  ).length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(31_000);
  });
  const after = global.fetch.mock.calls.filter((c) =>
    String(c[0]).startsWith("/api/me/verify/"),
  ).length;
  expect(after).toBe(before);
});

test("reduced motion: the badge lands without sparks", async () => {
  vi.stubGlobal("matchMedia", (q) => ({
    matches: q.includes("prefers-reduced-motion"),
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
  statusQueue = [VERIFIED];
  vi.useFakeTimers({ shouldAdvanceTime: true });
  window.history.pushState({}, "", "/account/verify");
  render(<App />);
  await waitFor(() => screen.getByText("King Thing"));
  fireEvent.click(screen.getByRole("button", { name: "Verify" }));
  await waitFor(() =>
    screen.getByRole("heading", { name: "Play one battle with this deck" }),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_100);
  });
  await waitFor(() => screen.getByText(/switch your deck back now/));
  expect(document.querySelectorAll(".verify__spark").length).toBe(0);
  expect(document.querySelector(".verify__burst").dataset.motion).toBe(
    "reduced",
  );
});

test("a start that finds no collection yet says so and retries", async () => {
  let n = 0;
  const base = global.fetch;
  global.fetch = vi.fn(async (path, init) => {
    if (
      String(path) === "/api/me/verify" &&
      (init?.method ?? "GET") === "POST"
    ) {
      n += 1;
      const body =
        n === 1
          ? {
              state: "collecting",
              player_tag: "#2PP0V90Y",
              live_pending: true,
              retry_after_s: 15,
            }
          : OPEN;
      return {
        ok: n !== 1,
        status: n === 1 ? 202 : 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    }
    return base(path, init);
  });
  vi.useFakeTimers({ shouldAdvanceTime: true });
  window.history.pushState({}, "", "/account/verify");
  render(<App />);
  await waitFor(() => screen.getByText("King Thing"));
  fireEvent.click(screen.getByRole("button", { name: "Verify" }));
  await waitFor(() => screen.getByText(/for the first time/));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_100);
  });
  await waitFor(() =>
    screen.getByRole("heading", { name: "Play one battle with this deck" }),
  );
  expect(n).toBe(2);
});
