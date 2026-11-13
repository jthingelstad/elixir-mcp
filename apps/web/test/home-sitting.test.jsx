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
