import { test, expect, afterEach } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import { BattleView } from "../src/views/Battle.jsx";
import { renderWithProviders } from "./helpers.jsx";

/**
 * A duel's page shows every game's decks (2026-11-13): an event's
 * multi-deck duel said "The record holds no deck for this side." on both
 * sides, because its read carried round decks and no games. The read
 * below is shaped as the record serves one today: deck null, three round
 * decks per player.
 */
afterEach(cleanup);

const card = (id, name) => ({ id, name, form: "base", level: 14 });
const roundDeck = (base, label) => ({
  cards: Array.from({ length: 8 }, (_, i) =>
    card(26000000 + base + i, `Card ${base + i}`),
  ),
  tower_troop: null,
  label,
  average_elixir: 3.5,
  cycle4: 9,
  average_level: 14,
});
const player = (tag, name, base) => ({
  player_tag: tag,
  name,
  clan_tag: null,
  clan_name: null,
  starting_trophies: null,
  trophy_change: null,
  global_rank: null,
  elixir_leaked: null,
  deck: null,
  rounds: [
    roundDeck(base, `Deck ${base} A`),
    roundDeck(base + 10, `Deck ${base} B`),
    roundDeck(base + 20, `Deck ${base} C`),
  ],
});
const result = (crowns) => ({
  crowns,
  tower_hp: { king: 5000, princess: [1000, 0] },
  elixir_leaked: 1.5,
});

function readOf({ games, score }) {
  return {
    battle: {
      id: "a".repeat(64),
      short_id: "aaaaaaaaaaaa",
      url: null,
      image: null,
      battle_time: "2026-11-13T12:00:00.000Z",
      type: "trail",
      kind: "duel",
      mode_group: "event",
      game_mode: { id: 72000400, name: "Competitive_Multideck" },
      arena: null,
      duration: null,
      deck_level_edge: null,
    },
    sides: [
      {
        outcome: "win",
        crowns: 3,
        tower_hp: null,
        players: [player("#0QRVVG22J", "Left One", 0)],
      },
      {
        outcome: "loss",
        crowns: 2,
        tower_hp: null,
        players: [player("#0LP0YQVQ9", "Right One", 100)],
      },
    ],
    games,
    ...(score ? { score } : {}),
    meetings: [],
    sitting: [],
    disclaimer: "",
  };
}

const NIL = "The record holds no deck for this side.";
const view = (read) =>
  renderWithProviders(
    <BattleView
      read={read}
      me={null}
      follow={false}
      invite={false}
      cheers={false}
    />,
  );

test("a duel with its games shows each game's decks on both sides", () => {
  view(
    readOf({
      games: [
        { round: 1, winner: "left", sides: [result(1), result(0)] },
        { round: 2, winner: "right", sides: [result(0), result(1)] },
        { round: 3, winner: "left", sides: [result(2), result(1)] },
      ],
      score: { left: 2, right: 1, unit: "games" },
    }),
  );
  expect(screen.queryByText(NIL)).toBeNull();
  expect(screen.getByText("Deck 0 A")).toBeTruthy();
  expect(screen.getByText("Deck 100 A")).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: /Game 3/ }));
  expect(screen.getByText("Deck 0 C")).toBeTruthy();
  expect(screen.getByText("Deck 100 C")).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Game 3 · 2–1" })).toBeTruthy();
});

test("a read with round decks and no games (cached before the fix) still shows the decks, with no score per game", () => {
  view(readOf({ games: null }));
  expect(screen.queryByText(NIL)).toBeNull();
  expect(screen.getByText("Deck 0 A")).toBeTruthy();
  expect(screen.getByText("Deck 100 A")).toBeTruthy();
  // No result to say, so the tab is the game alone and no tally is made up.
  expect(screen.getByRole("tab", { name: "Game 2" })).toBeTruthy();
  expect(
    screen.getByText("The record holds no result for this game."),
  ).toBeTruthy();
  expect(screen.getByText("crowns over 3 games")).toBeTruthy();
});

test("the no-deck line appears only for the side whose row holds no cards", () => {
  const read = readOf({
    games: [
      { round: 1, winner: "left", sides: [result(1), result(0)] },
      { round: 2, winner: "right", sides: [result(0), result(1)] },
      { round: 3, winner: "left", sides: [result(2), result(1)] },
    ],
  });
  read.sides[1].players[0].rounds = [null, null, null];
  view(read);
  expect(screen.getAllByText(NIL)).toHaveLength(1);
  expect(screen.getByText("Deck 0 A")).toBeTruthy();
});
