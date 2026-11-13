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
  // The words lead (G9): they come before where they went, Share and Edit
  // words are ordinary small buttons, and Delete is a quiet link.
  const text = container.textContent;
  expect(text.indexOf("<img src=x")).toBeLessThan(text.indexOf("timeline"));
  for (const name of ["Share", "Edit words"])
    expect(screen.getByRole("button", { name }).className).toBe("btn btn--sm");
  expect(screen.getByRole("button", { name: "Delete" }).className).toContain(
    "link",
  );
  // One per player per battle: no second compose for the same player.
  expect(
    screen.queryByRole("button", { name: "Post to your timeline" }),
  ).toBeNull();
});

const SHARED = {
  highlight_id: "22222222-2222-4222-8222-222222222222",
  player_tag: "#2PP",
  words: "gg",
  share_url: "https://elixir.poapkings.com/h/abc",
};

test("a shared highlight offers its clan's Discord only when the server says so, and asks first", async () => {
  vi.spyOn(api, "myHighlights").mockResolvedValue(
    ok({
      battle_id: "x",
      can_highlight_as: ["#2PP"],
      highlights: [
        { ...SHARED, clan_discord: { available: true, posted_at: null } },
      ],
    }),
  );
  const post = vi
    .spyOn(api, "postHighlightToClan")
    .mockResolvedValue(
      ok({ posted_at: "2026-11-13T00:00:00Z", already: false }),
    );
  renderWithProviders(<BattleHighlight battle={BATTLE} sides={SIDES} />);
  const trigger = await screen.findByRole("button", {
    name: "Post in your clan’s Discord",
  });
  // An additive act: a plain small button, never gold or red.
  expect(trigger.className).toBe("btn btn--sm");
  fireEvent.click(trigger);
  expect(post).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button", { name: "Post" }));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith("22222222-2222-4222-8222-222222222222"),
  );
});

test("a highlight already in the clan's Discord says so; one the clan does not take offers nothing", async () => {
  vi.spyOn(api, "myHighlights").mockResolvedValue(
    ok({
      battle_id: "x",
      can_highlight_as: ["#2PP"],
      highlights: [
        {
          ...SHARED,
          clan_discord: { available: false, posted_at: "2026-11-13T00:00:00Z" },
        },
      ],
    }),
  );
  renderWithProviders(<BattleHighlight battle={BATTLE} sides={SIDES} />);
  expect(
    await screen.findByText("Posted in your clan’s Discord."),
  ).toBeTruthy();
  cleanup();
  vi.spyOn(api, "myHighlights").mockResolvedValue(
    ok({
      battle_id: "x",
      can_highlight_as: ["#2PP"],
      highlights: [
        { ...SHARED, clan_discord: { available: false, posted_at: null } },
      ],
    }),
  );
  renderWithProviders(<BattleHighlight battle={BATTLE} sides={SIDES} />);
  await screen.findByText("“gg”");
  expect(
    screen.queryByRole("button", { name: "Post in your clan’s Discord" }),
  ).toBeNull();
});
