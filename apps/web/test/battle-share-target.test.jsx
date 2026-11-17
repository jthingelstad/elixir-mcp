import { test, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { BattleView } from "../src/views/Battle.jsx";
import { api } from "../src/api.js";
import { BATTLE } from "../e2e/battle-fixture.ts";

const FIRST_URL = "https://elixir.poapkings.com/share/abcdefghijklmnopqrstuvwx";
const NEXT_URL = "https://elixir.poapkings.com/share/zyxwvutsrqponmlkjihgfedc";
const next = {
  ...BATTLE,
  battle: { ...BATTLE.battle, id: "b".repeat(64), short_id: "b".repeat(12) },
};
const me = {
  authenticated: true,
  claims: [
    {
      player_tag: BATTLE.sides[0].players[0].player_tag,
      relationship: "primary",
    },
  ],
};
const ok = (data) => ({ ok: true, status: 200, data });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("a warm raw battle target clears the parent capability and optional context", async () => {
  vi.stubGlobal("navigator", {
    share: vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("cancelled"), { name: "AbortError" }),
      ),
  });
  vi.spyOn(api, "postsOnBattle").mockResolvedValue(
    ok({ posts: [], can_post_as: [] }),
  );
  vi.spyOn(api, "shareItem").mockImplementation(async ({ battle_ref }) =>
    ok({ url: battle_ref === BATTLE.battle.id ? FIRST_URL : NEXT_URL }),
  );
  const view = (read) => (
    <BattleView read={read} me={me} follow={false} cheers={false} />
  );
  const { rerender } = renderWithProviders(view(BATTLE));
  fireEvent.click(screen.getByRole("button", { name: "Share", exact: true }));
  await screen.findByRole("button", { name: "Share with your context" });
  fireEvent.click(
    screen.getByRole("button", { name: "Share with your context" }),
  );
  fireEvent.change(screen.getByLabelText(/Why did this battle matter/), {
    target: { value: "First battle only" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Preview message" }));
  expect(screen.getByLabelText("Message preview").value).toContain(FIRST_URL);

  // Keep the battle view mounted as its already-cached read changes.
  rerender(view(next));
  expect(screen.queryByLabelText("Message preview")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Share with your context" }),
  ).toBeNull();
  expect(screen.queryByRole("link", { name: "Share image" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Share", exact: true }));
  await screen.findByRole("button", { name: "Share with your context" });
  fireEvent.click(
    screen.getByRole("button", { name: "Share with your context" }),
  );
  expect(screen.getByLabelText(/Why did this battle matter/).value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Preview message" }));
  expect(screen.getByLabelText("Message preview").value).toContain(NEXT_URL);
  expect(screen.getByLabelText("Message preview").value).not.toContain(
    FIRST_URL,
  );
  await waitFor(() => expect(api.shareItem).toHaveBeenCalledTimes(2));
});
