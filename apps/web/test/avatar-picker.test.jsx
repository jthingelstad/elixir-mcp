/**
 * Settings › Profile's picture (2026-11-14): the catalog by name with the
 * tower troops out, a search, a pick that previews before Save, Save and
 * Remove through POST /api/me/avatar, and the sentence that says where it
 * shows. Invented names only.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import {
  AVATAR_PROMISE,
  AvatarPicker,
  hasVerifiedPlayer,
} from "../src/views/account/AvatarPicker.jsx";
import { renderWithProviders } from "./helpers.jsx";

const CARDS = {
  cards: [
    { id: 26000000, name: "Knight" },
    { id: 28000001, name: "Arrows" },
    { id: 26000010, name: "Skeleton Army" },
    { id: 159000000, name: "Tower Princess" },
  ],
};
const VERIFIED = [
  {
    player_tag: "#0PRJ8Y2C",
    name: "Invented Main",
    is_primary: true,
    relationship: "primary",
    status: "verified",
  },
];

let posts;
beforeEach(() => {
  cleanup();
  posts = [];
  global.fetch = vi.fn(async (path, init) => {
    let body = {};
    if (String(path) === "/api/public/cards") body = CARDS;
    if (String(path) === "/api/me/avatar") {
      const sent = JSON.parse(init.body);
      posts.push(sent);
      body = { ok: true, avatar_card_id: sent.card_id };
    }
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
});
afterEach(() => vi.restoreAllMocks());

test("the catalog by name, no tower troop, searchable, and the promise", async () => {
  renderWithProviders(
    <AvatarPicker me={{ claims: VERIFIED }} refresh={() => {}} />,
  );
  await waitFor(() => screen.getByRole("group", { name: "Cards" }));
  const names = screen
    .getAllByRole("button", { pressed: false })
    .map((b) => b.textContent);
  expect(names).toEqual(["Arrows", "Knight", "Skeleton Army"]);
  expect(screen.queryByText("Tower Princess")).toBeNull();
  expect(screen.getByText(AVATAR_PROMISE)).toBeTruthy();
  expect(screen.queryByText(/only you see it/)).toBeNull();

  fireEvent.change(screen.getByRole("searchbox", { name: "Search cards" }), {
    target: { value: "kni" },
  });
  expect(
    screen.getAllByRole("button", { pressed: false }).map((b) => b.textContent),
  ).toEqual(["Knight"]);
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "zzz" },
  });
  expect(screen.getByText("No card matches that.")).toBeTruthy();
});

test("a pick previews, Save sends it, and refresh reads it back", async () => {
  const refresh = vi.fn();
  renderWithProviders(
    <AvatarPicker me={{ claims: VERIFIED }} refresh={refresh} />,
  );
  await waitFor(() => screen.getByRole("group", { name: "Cards" }));
  const save = screen.getByRole("button", { name: "Save" });
  expect(save.disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Knight" }));
  expect(
    screen.getByRole("button", { name: "Knight" }).getAttribute("aria-pressed"),
  ).toBe("true");
  // The preview is the picked card's art before anything is saved.
  expect(document.querySelector(".avpick__head img")?.getAttribute("src")).toBe(
    "/assets/cards/26000000.png",
  );
  fireEvent.click(save);
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(posts).toEqual([{ card_id: 26000000 }]);
  expect(screen.getByRole("status").textContent).toBe("Saved.");
});

test("Remove clears the saved image; with no verified player, only you see it", async () => {
  const refresh = vi.fn();
  const me = {
    avatar_card_id: 28000001,
    claims: [{ ...VERIFIED[0], status: "unverified" }],
  };
  expect(hasVerifiedPlayer(me)).toBe(false);
  renderWithProviders(<AvatarPicker me={me} refresh={refresh} />);
  await waitFor(() => screen.getByRole("group", { name: "Cards" }));
  expect(screen.getByText(/only you see it, in your top bar/)).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Arrows" }).getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(posts).toEqual([{ card_id: null }]);
});
