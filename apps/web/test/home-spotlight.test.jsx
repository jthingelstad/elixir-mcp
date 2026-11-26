/**
 * The Timeline's clanmate notice (Jamie, 2026-11-26: it "needs a way to
 * 'Dismiss' / 'close' it"): the best match only; Dismiss remembers that
 * clanmate per account in this browser; a dismissed best match hides the
 * notice rather than showing the next best. Invented players only.
 */
import { test, expect, beforeEach, vi } from "vitest";
import { screen, fireEvent, cleanup } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { ClanDeckSpotlight } from "../src/home/People.jsx";
import {
  dismissSpotlight,
  spotlightDismissed,
  spotlightMatch,
} from "../src/home/logic.js";

const play = (shared, extra = {}) => ({
  own_name: "Ash",
  mode: "Ranked",
  shared,
  exact: false,
  card: null,
  own_cards: ["Fireball"],
  peer_cards: ["Poison"],
  ...extra,
});
const ADA = { player_tag: "#0PYLQ2", name: "Ada", shared_play: play(7) };
const CEDAR = { player_tag: "#02G2PJC0", name: "Cedar", shared_play: play(5) };
const reply = (body) => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => JSON.stringify(body),
});
const serve = (players) => {
  global.fetch = vi.fn(async (path) =>
    String(path).startsWith("/api/me/people/clan")
      ? reply({ ok: true, clans: [], players })
      : reply({}),
  );
};

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
});

test("the best match: most cards shared, an exact deck, then the card both play most, then the tag", () => {
  expect(spotlightMatch(undefined)).toBe(null);
  expect(spotlightMatch([{ player_tag: "#0PQ2VY", shared_play: null }])).toBe(
    null,
  );
  expect(spotlightMatch([CEDAR, ADA]).player_tag).toBe(ADA.player_tag);
  const exact = { ...CEDAR, shared_play: play(7, { exact: true }) };
  expect(spotlightMatch([ADA, exact]).player_tag).toBe(CEDAR.player_tag);
  const card = (tag, mine, theirs) => ({
    player_tag: tag,
    shared_play: play(0, { card: { mine, theirs } }),
  });
  expect(
    spotlightMatch([card("#0GRJCUV", 9, 1), card("#0YY9P", 3, 4)]).player_tag,
  ).toBe("#0YY9P");
  expect(
    spotlightMatch([card("#0YY9P", 2, 2), card("#0GRJCUV", 2, 2)]).player_tag,
  ).toBe("#0GRJCUV");
});

test("dismissals are kept per account, newest last, and never throw", () => {
  expect(spotlightDismissed("a")).toEqual([]);
  expect(dismissSpotlight("a", "#0GRJCUV")).toEqual(["#0GRJCUV"]);
  expect(dismissSpotlight("a", "#0YY9P")).toEqual(["#0GRJCUV", "#0YY9P"]);
  expect(dismissSpotlight("a", "#0GRJCUV")).toEqual(["#0YY9P", "#0GRJCUV"]);
  expect(spotlightDismissed("a")).toEqual(["#0YY9P", "#0GRJCUV"]);
  expect(spotlightDismissed("b")).toEqual([]);
  // Nobody signed in: nothing kept, but this visit's list comes back.
  expect(dismissSpotlight(null, "#0GRJCUV")).toEqual(["#0GRJCUV"]);
  expect(spotlightDismissed(null)).toEqual([]);
  // Something else in the key reads as none.
  window.localStorage.setItem("elixir.home.spotlight-dismissed:c", "{oops");
  expect(spotlightDismissed("c")).toEqual([]);
  const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(dismissSpotlight("d", "#0GRJCUV")).toEqual(["#0GRJCUV"]);
  set.mockRestore();
});

test("Dismiss hides the notice; the next best match does not take its place; a new best match brings it back", async () => {
  serve([ADA, CEDAR]);
  const first = renderWithProviders(<ClanDeckSpotlight who="acct-1" />);
  expect(
    await screen.findByText("A clanmate who plays your cards"),
  ).toBeTruthy();
  expect(screen.getByText("Ada")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(screen.queryByText("A clanmate who plays your cards")).toBeNull();
  expect(spotlightDismissed("acct-1")).toEqual([ADA.player_tag]);
  first.unmount();

  // Next visit, same best match: nothing, not Cedar.
  const again = renderWithProviders(<ClanDeckSpotlight who="acct-1" />);
  await vi.waitFor(() =>
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/me/people/clan"),
      expect.anything(),
    ),
  );
  await new Promise((r) => setTimeout(r, 20));
  expect(screen.queryByText("A clanmate who plays your cards")).toBeNull();
  again.unmount();

  // Another account in this browser still sees it.
  const other = renderWithProviders(<ClanDeckSpotlight who="acct-2" />);
  expect(await screen.findByText("Ada")).toBeTruthy();
  other.unmount();

  // Cedar becomes the best match: the notice is back, for Cedar.
  serve([ADA, { ...CEDAR, shared_play: play(8) }]);
  renderWithProviders(<ClanDeckSpotlight who="acct-1" />);
  expect(await screen.findByText("Cedar")).toBeTruthy();
  expect(screen.queryByText("Ada")).toBeNull();
});
