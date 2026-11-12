import { test, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { api } from "../src/api.js";
import { BattleHighlight } from "../src/views/BattleHighlight.jsx";
import { renderWithProviders } from "./helpers.jsx";

/**
 * The battle page's highlight panel (#762): it shows only what the server
 * answered about who may post, and words are text, never markup.
 */
const BATTLE = { id: "ccd04012bda8" };
const SIDES = [
  { players: [{ player_tag: "#2PP", name: '<b>"Ana"</b>' }] },
  { players: [{ player_tag: "#9QQ", name: "Bo" }] },
];
const ok = (data) => ({ ok: true, status: 200, data });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("nothing is drawn when the server names no player of yours", async () => {
  const read = vi
    .spyOn(api, "myHighlights")
    .mockResolvedValue(
      ok({ battle_id: "x", can_highlight_as: [], highlights: [] }),
    );
  const { container } = renderWithProviders(
    <BattleHighlight battle={BATTLE} sides={SIDES} />,
  );
  await waitFor(() => expect(read).toHaveBeenCalledWith("ccd04012bda8"));
  expect(container.textContent).toBe("");
});

test("a verified player of yours posts with your words, from the gold button", async () => {
  vi.spyOn(api, "myHighlights").mockResolvedValue(
    ok({ battle_id: "x", can_highlight_as: ["#2PP"], highlights: [] }),
  );
  const post = vi.spyOn(api, "postHighlight").mockResolvedValue({
    ok: true,
    status: 201,
    data: { highlight: {} },
  });
  renderWithProviders(<BattleHighlight battle={BATTLE} sides={SIDES} />);
  const button = await screen.findByRole("button", {
    name: "Post to your timeline",
  });
  expect(button.className).toContain("btn--gold");
  // The player's name is text in the sentence, quotes and markup and all.
  expect(screen.getByText(/<b>"Ana"<\/b>’s timeline/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Your words (optional)"), {
    target: { value: "Finally beat the cycle deck" },
  });
  fireEvent.click(button);
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith({
      battle: "ccd04012bda8",
      player_tag: "#2PP",
      words: "Finally beat the cycle deck",
    }),
  );
});

test("a posted highlight shows its words as text, with Share and Edit words", async () => {
  vi.spyOn(api, "myHighlights").mockResolvedValue(
    ok({
      battle_id: "x",
      can_highlight_as: ["#2PP"],
      highlights: [
        {
          highlight_id: "11111111-1111-4111-8111-111111111111",
          player_tag: "#2PP",
          words: "<img src=x onerror=alert(1)>",
          share_url: null,
        },
      ],
    }),
  );
  const { container } = renderWithProviders(
    <BattleHighlight battle={BATTLE} sides={SIDES} />,
  );
  await screen.findByRole("button", { name: "Share" });
  expect(screen.getByRole("button", { name: "Edit words" })).toBeTruthy();
  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  // One per player per battle: no second compose for the same player.
  expect(
    screen.queryByRole("button", { name: "Post to your timeline" }),
  ).toBeNull();
});
