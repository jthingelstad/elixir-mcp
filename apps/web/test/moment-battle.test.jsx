/**
 * A moment's battle strip on Home (canvas .mbattle, Codex on #853): a
 * promotion's proof and a crossing's proof both name the battle's result,
 * score and opponent. Invented players only.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { HomeFeed } from "../src/home/Feed.jsx";

vi.mock("../src/analytics.js", () => ({ trackEvent: () => {} }));

const AGO = (min) => new Date(Date.now() - min * 60_000).toISOString();
const moment = (id, kind, text, facts) => ({
  id: `tl_${id.padStart(20, "0")}`,
  kind,
  at: AGO(30),
  observed_at: AGO(29),
  subject_tag: "#2Y0P8V",
  subject_name: "Invented 1",
  subjects: [{ tag: "#2Y0P8V", kind: "player", name: "Invented 1" }],
  groups: ["friends"],
  text,
  facts,
  battle_url: `https://elixir.example.test/battle/b${id}c3d4e5f6a7`,
});
const withMode = (it, proof_mode) => ({ ...it, proof_mode });
const items = [
  withMode(
    moment("1", "best_trophies_band", "Invented 1 reached 9,000 trophies.", {
      crossed_by: {
        battle_id: "b1c3d4e5f6a7",
        crowns: 1,
        crowns_against: 2,
        opponent: { name: "Slate Owl" },
        trophies_after: 9012,
      },
    }),
    "ladder",
  ),
  moment("2", "ranked_promotion", "Invented 1 reached Master II.", {
    promoted_by: {
      battle_id: "b2c3d4e5f6a7",
      crowns: 3,
      crowns_against: 0,
      opponent: { name: "Copper Wren" },
    },
  }),
];

beforeEach(() => {
  global.fetch = vi.fn(async (path) => {
    const p = String(path).split("?")[0];
    const body =
      p === "/api/me/home/feed"
        ? {
            as_of: AGO(0),
            window: { from: AGO(10_080), to: AGO(0) },
            seen_to: AGO(0),
            timeline: items,
            total: items.length,
            next: null,
            timeline_more: 0,
          }
        : {};
    return { ok: true, text: async () => JSON.stringify(body) };
  });
});
afterEach(() => cleanup());

test("a crossing and a promotion both name their battle's result, score and opponent", async () => {
  renderWithProviders(<HomeFeed />);
  await screen.findByText("Invented 1 reached 9,000 trophies.");
  const strips = [...document.querySelectorAll(".kit-mbattle")];
  expect(strips.map((a) => [a.getAttribute("href"), a.textContent])).toEqual([
    [
      "/battle/b1c3d4e5f6a7",
      "Lost1-2 against Slate OwlTrophy Road · 9,012 trophies afterThe battle",
    ],
    ["/battle/b2c3d4e5f6a7", "Won3-0 over Copper WrenThe battle"],
  ]);
});

test("a highlight shows its words on the rule and both decks with the score between", async () => {
  const card = (id, name, cost, form = "base") => ({
    id,
    name,
    form,
    elixir_cost: cost,
  });
  const eight = (base, label) => ({
    label,
    cards: Array.from({ length: 8 }, (_, i) =>
      card(
        base + i,
        `Card ${base + i}`,
        (i % 5) + 1,
        i === 0 ? "evolution" : "base",
      ),
    ),
  });
  items.splice(0, items.length, {
    id: "tl_00000000000000000009",
    kind: "battle_highlight",
    at: AGO(30),
    observed_at: AGO(29),
    subject_tag: "#2Y0P8V",
    subject_name: "Invented 1",
    subjects: [{ tag: "#2Y0P8V", kind: "player", name: "Invented 1" }],
    groups: ["friends"],
    text: "Invented 1 highlighted a 2-1 win against Slate Owl (Path of Legends): “Held on.”",
    facts: {
      words: "Held on.",
      battle: {
        url: "https://elixir.example.test/battle/abc",
        mode_group: "ranked",
        outcome: "win",
        crowns: 2,
        crowns_against: 1,
        opponents: [{ name: "Slate Owl" }],
      },
    },
    versus: {
      mine: eight(26000000, "Invented cycle"),
      theirs: eight(26000100, "Invented beatdown"),
    },
  });
  renderWithProviders(<HomeFeed />);
  await screen.findByText(
    "Invented 1 highlighted a 2-1 win against Slate Owl (Path of Legends).",
  );
  expect(document.querySelector(".kit-feed__words").textContent).toBe(
    "Held on.",
  );
  expect(document.querySelectorAll(".kit-vs .kit-deckrow")).toHaveLength(2);
  expect(document.querySelector(".kit-vs__said").textContent).toBe(
    "Won 2 to 1",
  );
  expect(document.querySelector(".kit-vs__note").textContent).toBe(
    "Path of Legends",
  );
  expect(document.querySelectorAll(".kit-deckrow__cost")).toHaveLength(16);
  expect(screen.getByRole("link", { name: "Open battle" })).toBeTruthy();
});
