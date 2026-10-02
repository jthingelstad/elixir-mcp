/**
 * The top bar, as the Console draws it (canvas 2026-09-29).
 *
 * The account slot is filled from the session this app holds, and it is
 * one slot whatever fills it, so the bar never reshapes. At narrow width
 * the places, Docs and the game fold into a sheet behind one button that
 * names where you are.
 *
 * Both halves render the same markup at every width and let one media
 * query decide which is showing, so this asserts the markup exists and
 * behaves, not that a breakpoint was computed in JavaScript.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  waitFor,
  screen,
  fireEvent,
  cleanup,
} from "@testing-library/react";
import { App, consoleAccount } from "../src/App.jsx";

let me;
beforeEach(() => {
  cleanup();
  me = { authenticated: false };
  vi.spyOn(console, "error").mockImplementation(() => {});
  global.fetch = vi.fn(async (path) => {
    const body = String(path) === "/api/me" ? me : {};
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
  window.history.pushState({}, "", "/console/data/dashboard");
});
afterEach(() => vi.restoreAllMocks());

test("the narrow button names the Console and opens a sheet with every place, Docs and the game", async () => {
  render(<App />);
  const button = await screen.findByRole("button", {
    name: "Product: Console",
  });
  expect(button.getAttribute("aria-expanded")).toBe("false");

  const sheet = document.getElementById("chrome-sheet");
  expect(sheet.dataset.open).toBe("false");
  // The links are in the markup either way: a crawler and a reader with
  // no JavaScript both still find them.
  expect([...sheet.querySelectorAll("a")].map((a) => a.textContent)).toEqual([
    "Console",
    "Ladder",
    "Clan",
    "Docs",
    "Play Drop",
  ]);

  fireEvent.click(button);
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(sheet.dataset.open).toBe("true");
  fireEvent.keyDown(window, { key: "Escape" });
  expect(sheet.dataset.open).toBe("false");
  fireEvent.click(button);
  fireEvent.click(sheet.querySelector("a"));
  expect(sheet.dataset.open).toBe("false");
});

test("the places are on the bar, the Console lit and routed in this origin", async () => {
  render(<App />);
  const nav = await screen.findByRole("navigation", { name: "Products" });
  const places = [...nav.querySelectorAll("a")];
  expect(places.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
    ["Console", "/console"],
    ["Ladder", "/ladder"],
    ["Clan", "/clan"],
  ]);
  expect(places[0].getAttribute("aria-current")).toBe("page");
  const play = document.querySelector(".chrome__end .chrome__play");
  expect(play.getAttribute("target")).toBe("_blank");
  expect(
    document.querySelector(".chrome__end .chrome__docs").getAttribute("href"),
  ).toBe("/docs");
});

test("signed out, the account slot is Sign in, to this app's sign-in page", async () => {
  render(<App />);
  const signIn = await screen.findByRole("link", { name: "Sign in" });
  expect(signIn.closest(".chrome__account")).toBeTruthy();
  expect(signIn.getAttribute("href")).toBe("/console/signin");
});

test("signed in, the account slot is the person, and the menu holds the way out", async () => {
  me = {
    authenticated: true,
    email: "jamie@example.com",
    role: "owner",
    timezone: "America/Chicago",
    claims: [
      { player_tag: "#20JJJ2CCRU", name: "King Thing", is_primary: true },
      {
        player_tag: "#VJQV8G8RL",
        name: "thingles",
        is_primary: false,
        relationship: "alt",
      },
      // Tracked, not theirs: never under "Your players".
      {
        player_tag: "#U8RYG9Y2U",
        name: "King Levy",
        is_primary: false,
        relationship: "friend",
      },
    ],
    signals: {},
  };
  render(<App />);
  const button = await screen.findByRole("button", {
    name: "Account: King Thing",
  });
  fireEvent.click(button);
  const menu = document.getElementById("account-menu");
  expect(menu.textContent).toContain("owner · America/Chicago");
  expect(
    [...menu.querySelectorAll(".account-menu__player")].map((a) =>
      a.getAttribute("href"),
    ),
  ).toEqual([
    "/console/explore/player/20JJJ2CCRU",
    "/console/explore/player/VJQV8G8RL",
  ]);
  expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
});

test("while the session is unknown the slot is empty, never a guess", () => {
  expect(consoleAccount(null, false, {})).toBeUndefined();
  expect(consoleAccount({ authenticated: false }, true, {})).toBeUndefined();
  expect(consoleAccount({ authenticated: false }, false, {})).toBeNull();
  // An account with no player yet is its address.
  expect(
    consoleAccount({ authenticated: true, email: "a@b.c" }, false, {}).name,
  ).toBe("a@b.c");
});

test("a signed-in reader who follows Sign in goes on to their console", async () => {
  me = { authenticated: true, email: "jamie@example.com", signals: {} };
  window.history.pushState({}, "", "/console/signin");
  render(<App />);
  await waitFor(() =>
    expect(window.location.pathname).toBe("/console/account/overview"),
  );
});
