/**
 * A sitting's lines on Home (design canvas, 2026-11-13): its modes with its
 * widest win, and the note right of its figures, plain facts only. Invented
 * facts; no player.
 */
import { test, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Sitting, sittingNote } from "../src/home/Session.jsx";

afterEach(cleanup);

test("the note says a run of three or more and two or more 3-crown wins", () => {
  expect(sittingNote({ won_in_a_row: 4 }, { three_crowns: 2 })).toBe(
    "4 wins in a row · two 3-crown wins",
  );
  expect(sittingNote({ won_in_a_row: 2 }, { three_crowns: 1 })).toBe("");
  expect(sittingNote({ won_in_a_row: 3 }, null)).toBe("3 wins in a row");
  expect(sittingNote({}, { three_crowns: 7 })).toBe("7 3-crown wins");
});

test("the mode line names the widest win, and an old row says less", () => {
  const facts = { battles: 3, won: 2, lost: 1, by_mode: { ladder: 3 } };
  render(
    <Sitting
      it={{
        kind: "battle_session",
        facts,
        scores: { best_win: "3-0", three_crowns: 2 },
      }}
    />,
  );
  expect(screen.getByText("Trophy Road · best win 3-0")).toBeTruthy();
  expect(screen.getByText("two 3-crown wins")).toBeTruthy();
  cleanup();
  render(<Sitting it={{ kind: "battle_session", facts }} />);
  expect(screen.getByText("Trophy Road")).toBeTruthy();
});

test("a sitting draws its deck's eight cards with their costs under its label", () => {
  const cards = Array.from({ length: 8 }, (_, i) => ({
    id: 26000000 + i,
    name: `Card ${i}`,
    form: i === 0 ? "hero" : "base",
    elixir_cost: i + 1,
  }));
  const facts = {
    battles: 4,
    won: 3,
    lost: 1,
    by_mode: { ladder: 4 },
    decks: [{ label: "Invented cycle", battles: 4 }],
  };
  render(
    <Sitting
      it={{
        kind: "battle_session",
        facts,
        deck: { label: "Invented cycle", cards },
      }}
    />,
  );
  const row = screen.getByRole("list", {
    name: "Invented cycle, the deck played most",
  });
  expect(row.querySelectorAll("li")).toHaveLength(8);
  expect(row.querySelectorAll(".kit-deckrow__cost")[7].textContent).toBe("8");
  // A deck kept for another label (an old row) is not drawn.
  cleanup();
  render(
    <Sitting
      it={{ kind: "battle_session", facts, deck: { label: "Other", cards } }}
    />,
  );
  expect(screen.queryByRole("list")).toBeNull();
});
