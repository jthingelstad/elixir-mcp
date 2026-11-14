import { test, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { api } from "../src/api.js";
import {
  FollowFromHere,
  followSuggestions,
} from "../src/views/FollowFromHere.jsx";
import { Invite } from "../src/views/Battle.jsx";
import { renderWithProviders } from "./helpers.jsx";

/**
 * Joining from a link (#763): the signed-out way in carries only the page,
 * and the Follow suggestions come from the page's own players, never from
 * who sent the link.
 */
const SIDES = [
  { players: [{ player_tag: "#0CR", name: "Ana" }] },
  { players: [{ player_tag: "#08C", name: '<b>"Bo"</b>' }] },
];
const DUO = [
  {
    players: [
      { player_tag: "#0CR", name: "Ana" },
      { player_tag: "#0RV", name: "Cy" },
    ],
  },
  {
    players: [
      { player_tag: "#08C", name: "Bo" },
      { player_tag: "#00L", name: null },
    ],
  },
];
const ok = (data) => ({ ok: true, status: 200, data });
// The reader's own player, on none of these pages.
const MINE = { claims: [{ player_tag: "#0U0", relationship: "primary" }] };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("a battle's left side comes first; a post's player leads; your own are left out", () => {
  expect(followSuggestions(DUO, null).map((p) => p.tag)).toEqual([
    "#0CR",
    "#0RV",
    "#08C",
    "#00L",
  ]);
  expect(followSuggestions(DUO, null, "#08C").map((p) => p.tag)).toEqual([
    "#08C",
    "#0CR",
    "#0RV",
    "#00L",
  ]);
  const me = {
    claims: [
      { player_tag: "#0CR", relationship: "primary" },
      { player_tag: "#0RV", relationship: "friend" },
    ],
  };
  // A friend you already follow stays (it says Following); yours do not.
  expect(followSuggestions(DUO, me).map((p) => p.tag)).toEqual([
    "#0RV",
    "#08C",
    "#00L",
  ]);
  expect(followSuggestions([], me)).toEqual([]);
});

test("each player says what a Follow costs, and the Follow is Home's", async () => {
  vi.spyOn(api, "followCost").mockImplementation(async (tag) =>
    ok(
      tag === "#0CR"
        ? { player_tag: tag, following: false, free: true, used: 3, limit: 50 }
        : {
            player_tag: tag,
            following: false,
            free: false,
            used: 3,
            limit: 50,
          },
    ),
  );
  const claim = vi
    .spyOn(api, "claimAction")
    .mockResolvedValue(
      ok({ player_tag: "#08C", relationship: "friend", added: true }),
    );
  renderWithProviders(<FollowFromHere sides={SIDES} me={MINE} />);
  expect(
    await screen.findByText(
      "Free · already recorded · 3 of your 50 follows used",
    ),
  ).toBeTruthy();
  expect(
    await screen.findByText("Uses 1 of your 50 follows · 3 used"),
  ).toBeTruthy();
  // A name is text, markup and all.
  expect(screen.getByText('<b>"Bo"</b>')).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: 'Follow <b>"Bo"</b>' }));
  await waitFor(() =>
    expect(claim).toHaveBeenCalledWith({
      player_tag: "#08C",
      relationship: "friend",
    }),
  );
  expect(await screen.findByText("Following")).toBeTruthy();
});

test("a player already followed says so, and a full pool cannot take a slot", async () => {
  vi.spyOn(api, "followCost").mockImplementation(async (tag) =>
    ok(
      tag === "#0CR"
        ? { player_tag: tag, following: true, free: true, used: 50, limit: 50 }
        : {
            player_tag: tag,
            following: false,
            free: false,
            used: 50,
            limit: 50,
          },
    ),
  );
  renderWithProviders(<FollowFromHere sides={SIDES} me={MINE} />);
  expect(await screen.findByText("Following")).toBeTruthy();
  expect(await screen.findByText(/All 50 player slots in use/)).toBeTruthy();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: 'Follow <b>"Bo"</b>' }).disabled,
    ).toBe(true),
  );
});

test("an account with no player of its own is asked for it first, as on Home", () => {
  const followCost = vi.spyOn(api, "followCost");
  renderWithProviders(<FollowFromHere sides={SIDES} me={{ claims: [] }} />);
  expect(screen.getByText(/Add your own player first/)).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Add your player" }).getAttribute("href"),
  ).toBe("/home");
  expect(screen.queryByRole("button", { name: /^Follow / })).toBeNull();
  expect(followCost).not.toHaveBeenCalled();
});

test("the way in carries only this page, to Join Elixir and to Sign in", () => {
  window.history.pushState({}, "", "/h/abcdefghijklmno");
  renderWithProviders(<Invite who="Ana" />);
  expect(screen.getByText("Follow Ana on Elixir")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Join Elixir" }).getAttribute("href"),
  ).toBe("/signin?signup&return_to=%2Fh%2Fabcdefghijklmno");
  expect(
    screen.getByRole("link", { name: "Sign in" }).getAttribute("href"),
  ).toBe("/signin?return_to=%2Fh%2Fabcdefghijklmno");
});
