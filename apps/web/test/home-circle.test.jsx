/**
 * Your circle this week and close friends (2026-11-16): the panel's three
 * states (friends marked, none marked with players to offer, nothing to
 * offer), its words as facts with no ranking, the star's one tap, and the
 * feed's Close friends chip remembered per account. Invented players only.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  screen,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { Circle } from "../src/home/Circle.jsx";
import {
  circleDetail,
  circleLine,
  circleWhy,
  askedShow,
  feedChips,
  keepShow,
  keptShow,
} from "../src/home/logic.js";

vi.mock("../src/analytics.js", () => ({ trackEvent: () => {} }));

const AGO = (min) => new Date(Date.now() - min * 60_000).toISOString();

const FRIENDS = [
  {
    tag: "#0YRL2GQP",
    name: "Moss Lantern",
    battles: 12,
    days: 3,
    last_battle_at: AGO(30),
    sittings: 2,
    session: { id: "s-1", started_at: AGO(90) },
    moments: [{ kind: "trophy_best", text: "Moss Lantern reached a new best" }],
  },
  {
    tag: "#0UVC8J9R",
    name: "<b>Quill</b>",
    battles: 1,
    days: 1,
    last_battle_at: AGO(600),
    sittings: null,
    session: null,
    moments: [],
  },
  {
    tag: "#0LCVJ8YR",
    name: "Tin Heron",
    battles: 0,
    days: 0,
    last_battle_at: null,
    sittings: null,
    session: null,
    moments: [],
  },
];

let circle;
let posted;
beforeEach(() => {
  posted = [];
  global.fetch = vi.fn(async (path, init) => {
    const p = String(path).split("?")[0];
    if (p === "/api/me/home/circle")
      return { ok: true, text: async () => JSON.stringify({ circle }) };
    if (p === "/api/claims" && init?.method === "POST") {
      const body = JSON.parse(init.body);
      posted.push(body);
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            ok: true,
            close: body.action === "close_on",
            tags: [body.player_tag],
          }),
      };
    }
    return { ok: true, text: async () => JSON.stringify({}) };
  });
});
afterEach(() => {
  cleanup();
  try {
    window.localStorage.clear();
  } catch {
    // jsdom always has it.
  }
});

test("a friend's week is facts: battles and days, or none, never a nudge", () => {
  expect(circleLine(FRIENDS[0])).toBe("12 battles · 3 days");
  expect(circleLine(FRIENDS[1])).toBe("1 battle · 1 day");
  expect(circleLine(FRIENDS[2])).toBe("No battles this week");
  expect(circleDetail(FRIENDS[0])).toBe("12 battles · 3 days · 2 sessions");
  // Sittings the stored week did not tell are left unsaid, not zero.
  expect(circleDetail(FRIENDS[1])).toBe("1 battle · 1 day");
  expect(circleWhy({ follows_you: true, clanmate: true })).toBe(
    "Follows you · Clanmate",
  );
  expect(circleWhy({})).toBe("You follow them");
  for (const f of FRIENDS)
    expect(circleDetail(f)).not.toMatch(/win|loss|rate|%|rank|best friend/i);
});

test("Close friends is a Show chip only once one is marked", () => {
  expect(feedChips(false).map((c) => c.key)).toEqual([
    "everyone",
    "friends",
    "clan",
    "you",
  ]);
  expect(feedChips(true).map((c) => c.key)).toEqual([
    "everyone",
    "close",
    "friends",
    "clan",
    "you",
  ]);
});

test("the Show choice is kept per account, and anything odd is Everyone", () => {
  expect(keptShow("acct-a")).toBe("everyone");
  keepShow("acct-a", "close");
  expect(keptShow("acct-a")).toBe("close");
  expect(keptShow("acct-b")).toBe("everyone");
  keepShow("acct-a", "everyone");
  expect(keptShow("acct-a")).toBe("everyone");
  window.localStorage.setItem("elixir.home.show:acct-a", "nonsense");
  expect(keptShow("acct-a")).toBe("everyone");
  // No account, nothing kept.
  keepShow(null, "close");
  expect(keptShow(null)).toBe("everyone");
});

test("an address may ask for a chip (the close friends notice's ?show=close); anything else asks nothing", () => {
  expect(askedShow("?show=close")).toBe("close");
  expect(askedShow("?show=clan&x=1")).toBe("clan");
  expect(askedShow("?show=nonsense")).toBeNull();
  expect(askedShow("")).toBeNull();
  expect(askedShow(undefined)).toBeNull();
  // Asked is not kept: the next visit is what the reader chose.
  expect(keptShow("acct-asked")).toBe("everyone");
});

test("blocked storage never breaks the feed's choice", () => {
  const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(keptShow("acct-a")).toBe("everyone");
  expect(() => keepShow("acct-a", "close")).not.toThrow();
  get.mockRestore();
  set.mockRestore();
});

test("marked friends: a strip in the read's order, quiet said plainly, names escaped", async () => {
  circle = { ok: true, from: AGO(3000), friends: FRIENDS };
  renderWithProviders(<Circle />);
  const strip = await screen.findByRole("list", { name: "Your close friends" });
  const items = within(strip).getAllByRole("listitem");
  expect(items.map((li) => li.textContent)).toEqual([
    expect.stringContaining("Moss Lantern12 battles · 3 days"),
    expect.stringContaining("<b>Quill</b>1 battle · 1 day"),
    expect.stringContaining("Tin HeronNo battles this week"),
  ]);
  // A hostile name is text, never markup.
  expect(strip.querySelector("b")).toBeNull();
  // The newest sitting opens its session page; the rest their player page.
  const links = within(strip).getAllByRole("link");
  expect(links[0].getAttribute("href")).toMatch(
    /^\/home\/player\/0YRL2GQP\/session\/s-1\?at=/,
  );
  expect(links[2].getAttribute("href")).toBe("/home/player/0LCVJ8YR");
  // See all: the fuller list, with the timeline's moments and the star.
  fireEvent.click(screen.getByRole("button", { name: "See all" }));
  expect(screen.getByText("Moss Lantern reached a new best")).toBeTruthy();
  expect(screen.getByText("12 battles · 3 days · 2 sessions")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Latest session" }).getAttribute("href"),
  ).toMatch(/\/session\/s-1/);
  const star = screen.getByRole("button", {
    name: "Tin Heron: close friend",
  });
  expect(star.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(star);
  await waitFor(() =>
    expect(posted).toEqual([{ action: "close_off", player_tag: "#0LCVJ8YR" }]),
  );
});

test("nobody marked: players you follow to star, why as facts, one tap", async () => {
  circle = {
    ok: true,
    from: AGO(3000),
    friends: [],
    suggestions: [
      {
        tag: "#0RQYGC2L",
        name: "Fern Ladder",
        follows_you: true,
        clanmate: true,
      },
      {
        tag: "#0GUQ28PV",
        name: "Ash Wren",
        follows_you: false,
        clanmate: true,
      },
      {
        tag: "#0QYC9U2P",
        name: "Slate Owl",
        follows_you: false,
        clanmate: false,
      },
    ],
  };
  renderWithProviders(<Circle />);
  await screen.findByRole("heading", { name: "Your circle" });
  expect(screen.getByText(/Only you see who you star/)).toBeTruthy();
  const strip = screen.getByRole("list", { name: "Players you follow" });
  expect(within(strip).getAllByRole("listitem")).toHaveLength(3);
  expect(within(strip).getByText("Follows you · Clanmate")).toBeTruthy();
  fireEvent.click(
    within(strip).getByRole("button", { name: "Mark Ash Wren a close friend" }),
  );
  await waitFor(() =>
    expect(posted).toEqual([{ action: "close_on", player_tag: "#0GUQ28PV" }]),
  );
});

test("nothing to offer, or a failed read, draws no box at all", async () => {
  circle = { ok: true, from: AGO(3000), friends: [], suggestions: [] };
  const { container } = renderWithProviders(<Circle />);
  await waitFor(() =>
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/me/home/circle",
      expect.anything(),
    ),
  );
  await new Promise((r) => setTimeout(r, 20));
  expect(container.textContent).toBe("");
  cleanup();
  circle = { ok: false };
  const again = renderWithProviders(<Circle />);
  await new Promise((r) => setTimeout(r, 20));
  expect(again.container.textContent).toBe("");
});
