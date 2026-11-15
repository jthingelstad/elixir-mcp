/**
 * A quiet Home (#1016): an empty week says why from the passport's follow
 * counts, never "they didn't play" while Elixir is still catching up, and
 * leads to Find, never to account maintenance. With `suggest`, People to
 * follow sits under it. Invented players only.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { HomeFeed } from "../src/home/Feed.jsx";
import { quietFeed } from "../src/home/logic.js";

vi.mock("../src/analytics.js", () => ({ trackEvent: () => {} }));

const AGO = (min) => new Date(Date.now() - min * 60_000).toISOString();
const EMPTY = {
  as_of: AGO(0),
  window: { from: AGO(10_080), to: AGO(0) },
  seen_to: AGO(120),
  timeline: [],
  total: 0,
  next: null,
  timeline_more: 0,
};

let follows;
let asked;
beforeEach(() => {
  asked = [];
  global.fetch = vi.fn(async (path) => {
    const p = String(path).split("?")[0];
    asked.push(p);
    if (p === "/api/me/home/feed")
      return { ok: true, text: async () => JSON.stringify(EMPTY) };
    if (p === "/api/me/passport")
      return {
        ok: true,
        text: async () =>
          JSON.stringify({ owner: { profile: { follows }, stamps: [] } }),
      };
    if (p === "/api/me/people/suggested")
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            ok: true,
            people: [
              {
                tag: "#00JQ20",
                name: "Invented 1",
                why: [
                  {
                    kind: "battles",
                    against: 1,
                    friendly: 1,
                    with_you: 0,
                    days: 7,
                  },
                ],
              },
            ],
            used: 1,
            limit: 50,
          }),
      };
    return { ok: true, text: async () => JSON.stringify({}) };
  });
});
afterEach(() => cleanup());

test("the quiet line tells nobody followed, catching up and quiet apart", () => {
  expect(quietFeed(null).key).toBe("unknown");
  expect(
    quietFeed({ following: 0, active: 0, inactive: 0, unknown: 0 }).key,
  ).toBe("none");
  // Unknown recording is never a quiet week.
  expect(
    quietFeed({ following: 3, active: 0, inactive: 2, unknown: 1 }).title,
  ).toBe("Still catching up");
  // A recorded battle the stored feed has not caught: catching up too.
  expect(
    quietFeed({ following: 3, active: 1, inactive: 2, unknown: 0 }).key,
  ).toBe("catching_up");
  expect(
    quietFeed({ following: 3, active: 0, inactive: 3, unknown: 0 }).title,
  ).toBe("The players you follow have been quiet");
  expect(
    quietFeed({ following: 1, active: 0, inactive: 1, unknown: 0 }).title,
  ).toBe("The player you follow has been quiet");
});

test("a quiet week names its reason and leads to Find, not Settings", async () => {
  follows = { following: 4, active: 0, inactive: 4, unknown: 0 };
  renderWithProviders(<HomeFeed />);
  expect(
    await screen.findByText("The players you follow have been quiet"),
  ).toBeTruthy();
  const find = screen.getByRole("link", { name: "Find your people" });
  expect(find.getAttribute("href")).toBe("/home/find");
  expect(screen.queryByText(/notify/)).toBeNull();
  // Without suggest, no people read of its own.
  expect(asked).not.toContain("/api/me/people/suggested");
});

test("catching up is said as such, and People to follow sits under it with suggest", async () => {
  follows = { following: 2, active: 0, inactive: 0, unknown: 2 };
  renderWithProviders(<HomeFeed suggest />);
  expect(await screen.findByText("Still catching up")).toBeTruthy();
  expect(await screen.findByText("People to follow")).toBeTruthy();
  expect(await screen.findByText("Invented 1")).toBeTruthy();
});

test("unread counts claim nothing either way", async () => {
  follows = undefined;
  renderWithProviders(<HomeFeed />);
  expect(
    await screen.findByText("Nothing in the last seven days"),
  ).toBeTruthy();
});
