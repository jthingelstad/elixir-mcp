import { test, expect, vi, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import { api } from "../src/api.js";
import { Post } from "../src/views/Post.jsx";
import { BATTLE } from "../e2e/battle-fixture.ts";
import { renderWithProviders } from "./helpers.jsx";

/**
 * A shared post, /h/<id> (canvas Highlight, 2026-11-13): who won and the
 * score, both decks with the score between, four numbers side by side and
 * the way to the battle's own page. Invented players only.
 */
const ok = (data) => ({ ok: true, status: 200, data });
const HOSTILE = '<img src=x onerror="alert(1)">';
const post = (side = "left") => {
  const sides = structuredClone(BATTLE.sides);
  sides[1].players[0].name = HOSTILE;
  return {
    ...BATTLE,
    sides,
    highlight: {
      share_id: "k7q2mabcdefghij",
      url: "https://elixir.example.test/h/k7q2mabcdefghij",
      image: "https://elixir.example.test/h/k7q2mabcdefghij.png",
      player_tag: sides[side === "left" ? 0 : 1].players[0].player_tag,
      name: sides[side === "left" ? 0 : 1].players[0].name,
      side,
      outcome: side === "left" ? "win" : "loss",
      words: "Two pushes at the end.",
      created_at: "2026-11-10T14:00:00.000Z",
    },
  };
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("the post: its player's result, both decks with the score, and the full battle", async () => {
  vi.spyOn(api, "publicPost").mockResolvedValue(ok(post()));
  const { container } = renderWithProviders(
    <Post shareId="k7q2mabcdefghij" me={{ authenticated: false }} />,
  );
  const title = await screen.findByRole("heading", { level: 1 });
  expect(title.textContent).toBe(`Birch Lantern beat ${HOSTILE} 2-1`);
  // Names are text at every output, never markup.
  expect(container.querySelector("img[src='x']")).toBeNull();
  expect(screen.getByText("Two pushes at the end.")).toBeTruthy();
  expect(container.querySelectorAll(".kit-vs .kit-deckrow")).toHaveLength(2);
  expect(screen.getByText("2 to 1 crowns")).toBeTruthy();
  expect(screen.getByText("Average elixir")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "The full battle" }).getAttribute("href"),
  ).toBe("/battle/ccd04012bda8");
  // Signed out: the way in, under the post.
  expect(screen.getByText("Follow Birch Lantern on Elixir")).toBeTruthy();
});

test("a post from the right-hand side reads from its own player", async () => {
  vi.spyOn(api, "publicPost").mockResolvedValue(ok(post("right")));
  renderWithProviders(
    <Post shareId="k7q2mabcdefghij" me={{ authenticated: false }} />,
  );
  const title = await screen.findByRole("heading", { level: 1 });
  expect(title.textContent).toBe(`${HOSTILE} lost to Birch Lantern 1-2`);
});

test("a 2v2 post keeps every player's deck through the battle's own view", async () => {
  const p = post();
  p.sides[0].players.push({
    ...structuredClone(p.sides[0].players[0]),
    player_tag: "#PYLQ99",
    name: "Willow Kite",
  });
  p.sides[1].players.push({
    ...structuredClone(p.sides[1].players[0]),
    player_tag: "#PYLQ77",
    name: "Cedar Gull",
  });
  vi.spyOn(api, "publicPost").mockResolvedValue(ok(p));
  const { container } = renderWithProviders(
    <Post shareId="k7q2mabcdefghij" me={{ authenticated: false }} />,
  );
  const title = await screen.findByRole("heading", { level: 1 });
  expect(title.textContent).toBe(
    `Birch Lantern and Willow Kite beat ${HOSTILE} and Cedar Gull 2-1`,
  );
  // No side-by-side pair for four players: the battle view draws all four.
  expect(container.querySelector(".kit-vs")).toBeNull();
  expect(container.querySelector(".kit-nums")).toBeNull();
  expect(screen.getAllByText("Willow Kite").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Cedar Gull").length).toBeGreaterThan(0);
  expect(container.querySelector("img[src='x']")).toBeNull();
});
