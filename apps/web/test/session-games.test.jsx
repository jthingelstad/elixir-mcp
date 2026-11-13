/**
 * An opened session (2026-11-13): its battles newest first under the deck
 * each run was played with, a 2v2's teammate, a duel's games, the trophies
 * moved and a way to each battle. Invented players and cards only.
 */
import { test, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { SessionGames } from "../src/home/SessionGames.jsx";
import {
  deckRuns,
  gameScore,
  sameCards,
  trophyWord,
} from "../src/home/session-games.js";

afterEach(cleanup);

const cards = (base) =>
  Array.from({ length: 8 }, (_, i) => ({
    id: base + i,
    name: `Card ${base + i}`,
    form: "base",
    elixir_cost: (i % 5) + 1,
  }));
const DECKS = [
  { label: "Invented cycle", cards: cards(26000000) },
  { label: null, cards: cards(26000100) },
];
const foe = (name, crowns, extra = {}) => ({
  player_tag: "#0P2GQ28C",
  name,
  crowns,
  clan_tag: null,
  clan_name: null,
  ...extra,
});

const PAGE = {
  kind: "session",
  count: 4,
  open: true,
  completeness: "recorded_sitting",
  order: "newest_first",
  next_offset: null,
  decks: DECKS,
  battles: [
    {
      battle_id: "d",
      at: "2026-11-10T14:40:00.000Z",
      mode_group: "war",
      outcome: "win",
      crowns: 3,
      opponents: [foe("Larch", 3)],
      games: [
        { round: 1, crowns: 1, against: 0, outcome: "win" },
        { round: 2, crowns: 0, against: 1, outcome: "loss" },
        { round: 3, crowns: 2, against: 2, outcome: null },
      ],
      url: "https://elixir.example.test/battle/duel000001",
    },
    {
      battle_id: "t",
      at: "2026-11-10T14:30:00.000Z",
      mode_group: "casual",
      outcome: "loss",
      crowns: 0,
      teammates: [{ player_tag: "#0VY8RUJ2", name: "Hazel" }],
      opponents: [
        foe("Rowan", 1),
        foe("Larch", 1, { player_tag: "#0LCJ2Y8U" }),
      ],
      url: "https://elixir.example.test/battle/twos000001",
    },
    {
      battle_id: "b",
      at: "2026-11-10T14:20:00.000Z",
      mode_group: "ladder",
      outcome: "loss",
      crowns: 1,
      trophy_change: -29,
      deck: 1,
      opponents: [foe("<img src=x onerror=alert(1)>", 2)],
      url: "https://elixir.example.test/battle/ladder0002",
    },
    {
      battle_id: "a",
      at: "2026-11-10T14:10:00.000Z",
      mode_group: "ladder",
      outcome: "win",
      crowns: 3,
      trophy_change: 30,
      deck: 0,
      opponents: [foe("Rowan", 0, { clan_name: "Grove" })],
      url: "https://elixir.example.test/battle/ladder0001",
    },
  ],
};

const ITEM = {
  kind: "battle_session",
  facts: { battles: 4, by_mode: { ladder: 2, casual: 1, war: 1 } },
};

const query = (data, over = {}) => ({
  isPending: false,
  isFetching: false,
  isSuccess: true,
  isError: false,
  data,
  ...over,
});

test("runs break where the deck changes; a game with no deck is its own run", () => {
  const runs = deckRuns(PAGE.battles, DECKS);
  expect(runs.map((r) => [r.key, r.games.map((g) => g.battle_id)])).toEqual([
    [null, ["d", "t"]],
    [1, ["b"]],
    [0, ["a"]],
  ]);
});

test("scores, trophies and same-deck checks say only what the record holds", () => {
  expect(gameScore(PAGE.battles[3])).toBe("3–0");
  // A duel whose last game was level on crowns: no games-won score.
  expect(gameScore(PAGE.battles[0])).toBe(null);
  expect(gameScore({ games: [{ outcome: "win" }, { outcome: "win" }] })).toBe(
    "2–0",
  );
  expect(gameScore({ crowns: 1, opponents: [] })).toBe(null);
  expect(trophyWord({ trophy_change: 30 })).toBe("+30");
  expect(trophyWord({ trophy_change: -29 })).toBe("−29");
  expect(trophyWord({ trophy_change: 0, mode_group: "ladder" })).toBe("0");
  expect(trophyWord({ trophy_change: 0, mode_group: "casual" })).toBe(null);
  expect(trophyWord({})).toBe(null);
  expect(sameCards(DECKS[0], { cards: [...cards(26000000)].reverse() })).toBe(
    true,
  );
  expect(sameCards(DECKS[0], DECKS[1])).toBe(false);
});

test("the opened session draws its battles, decks, teammate and duel games", () => {
  render(
    <SessionGames
      item={ITEM}
      query={query(PAGE)}
      offset={0}
      setOffset={() => {}}
      onRefresh={() => {}}
    />,
  );
  expect(screen.getByText("4 battles")).toBeTruthy();
  expect(screen.getByText("Still playing")).toBeTruthy();
  const rows = document.querySelectorAll(".kit-sgame");
  expect([...rows].map((r) => r.className)).toEqual([
    "kit-sgame kit-sgame--win",
    "kit-sgame kit-sgame--loss",
    "kit-sgame kit-sgame--loss",
    "kit-sgame kit-sgame--win",
  ]);
  // The duel's games, each its own score.
  const games = within(rows[0]).getByRole("list", { name: "The duel's games" });
  expect(games.textContent).toContain("1–0");
  expect(games.textContent).toContain("2–2");
  // The 2v2 names the teammate, then the other side.
  expect(rows[1].textContent).toMatch(/with Hazel vs Rowan and Larch/);
  // A hostile name is text, never markup.
  expect(rows[2].querySelector("img")).toBe(null);
  expect(rows[2].textContent).toContain("<img src=x onerror=alert(1)>");
  expect(rows[2].textContent).toContain("−29");
  expect(rows[3].textContent).toContain("+30");
  expect(rows[3].textContent).toContain("Grove");
  // Each run's cards, with its label when the deck has one.
  expect(screen.getByText("Invented cycle")).toBeTruthy();
  expect(screen.getAllByRole("list", { name: /its eight cards/ })).toHaveLength(
    2,
  );
  // Names open the player page; each row opens its battle.
  expect(
    within(rows[1]).getByRole("link", { name: "Hazel" }).getAttribute("href"),
  ).toBe("/home/player/0VY8RUJ2");
  expect(
    within(rows[3])
      .getByRole("link", { name: /^Battle/ })
      .getAttribute("href"),
  ).toBe("/battle/ladder0001");
  // Several modes in the sitting: each row says its own.
  expect(rows[0].textContent).toContain("War");
});

test("a page played with the deck the item already shows leaves its cards above", () => {
  const one = {
    ...PAGE,
    count: 1,
    battles: [PAGE.battles[3]],
  };
  render(
    <SessionGames
      item={{ ...ITEM, deck: DECKS[0] }}
      query={query(one)}
      offset={0}
      setOffset={() => {}}
      onRefresh={() => {}}
    />,
  );
  expect(screen.getByText("Invented cycle")).toBeTruthy();
  expect(
    screen.queryAllByRole("list", { name: /its eight cards/ }),
  ).toHaveLength(0);
});

test("a milestone's update says when its count and the record differ", () => {
  render(
    <SessionGames
      item={{
        kind: "session_standout",
        facts: { battles: 15, by_mode: { ladder: 15 } },
      }}
      query={query(PAGE)}
      offset={0}
      setOffset={() => {}}
      onRefresh={() => {}}
    />,
  );
  expect(
    screen.getByText("The update counts 15 battles; 4 are on record here."),
  ).toBeTruthy();
  expect(
    screen.getByText(/These end at the milestone this update names/),
  ).toBeTruthy();
});

test("reading, a changed read and paging say so", () => {
  const setOffset = [];
  render(
    <SessionGames
      item={ITEM}
      query={query(undefined, { isPending: true, isSuccess: false })}
      offset={0}
      setOffset={() => {}}
      onRefresh={() => {}}
    />,
  );
  expect(screen.getByRole("status").textContent).toBe("Reading the games…");
  cleanup();
  render(
    <SessionGames
      item={ITEM}
      query={query(undefined, { isError: true, isSuccess: false })}
      offset={0}
      setOffset={() => {}}
      onRefresh={() => {}}
    />,
  );
  expect(screen.getByRole("alert").textContent).toContain("Refresh");
  cleanup();
  render(
    <SessionGames
      item={ITEM}
      query={query({
        ...PAGE,
        completeness: "anchor_bound",
        open: false,
        next_offset: 25,
      })}
      offset={25}
      setOffset={(n) => setOffset.push(n)}
      onRefresh={() => {}}
    />,
  );
  expect(screen.queryByText("Still playing")).toBe(null);
  expect(
    screen.getByText(/The start of this session may be missing/),
  ).toBeTruthy();
  screen.getByRole("button", { name: "Older battles" }).click();
  screen.getByRole("button", { name: "Newer battles" }).click();
  expect(setOffset).toEqual([25, 0]);
});
