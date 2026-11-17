/**
 * A sitting's mode chips (2026-11-16): a Ranked climb and rating, a
 * challenge run, and the followed players it was played with or against.
 * Invented facts and names; no player.
 */
import { test, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ModeLine, modeChips } from "../src/home/ModeLine.jsx";
import { Sitting } from "../src/home/Session.jsx";

afterEach(cleanup);

const texts = (f) => modeChips(f).map((c) => c.text);

test("a Ranked sitting names its climb, or its league, and the rating at the top", () => {
  expect(
    texts({
      ranked: {
        league_to_name: "Champion",
        promotions: [
          { from: 3, to: 4, from_name: "Master III", to_name: "Champion" },
        ],
      },
    }),
  ).toEqual(["Climbed Master III to Champion"]);
  expect(
    texts({
      ranked: {
        league_to_name: "Ultimate Champion",
        promotions: [],
        rating: { from: 1850, to: 1940 },
      },
    }),
  ).toEqual(["Ranked: Ultimate Champion", "Rating 1,850 to 1,940"]);
});

test("a challenge run says how far it got and that its decks were drawn", () => {
  expect(
    texts({
      events: [
        { event_tag: "#0Q2L8", name: "Classic Challenge", run_wins: 5 },
        { event_tag: "#0YY9P", name: "C.H.A.O.S Draft", drawn_decks: true },
        { name: "Classic 1v1" },
      ],
    }),
  ).toEqual([
    "Classic Challenge: up to 5 wins",
    "C.H.A.O.S Draft: drafted decks",
  ]);
});

test("followed players are named with, against, or both; nothing when none", () => {
  expect(
    texts({
      together: [
        { player_tag: "#0PLUG2V9", name: "Slate Owl", with: 3, against: 0 },
        { player_tag: "#00JQ20", name: "Invented 1", with: 0, against: 2 },
        { player_tag: "#0Q2L8", name: "Invented 2", with: 1, against: 1 },
      ],
    }),
  ).toEqual([
    "With Slate Owl",
    "Against Invented 1",
    "With and against Invented 2",
  ]);
  const { container } = render(<ModeLine facts={{ battles: 3 }} />);
  expect(container.innerHTML).toBe("");
});

test("the card shows the chips, a one-battle 2v2 included", () => {
  render(
    <Sitting
      it={{
        id: "tl_1",
        facts: {
          battles: 1,
          won: 1,
          by_mode: { casual: 1 },
          together: [
            { player_tag: "#0PLUG2V9", name: "Slate Owl", with: 1, against: 0 },
          ],
        },
      }}
    />,
  );
  expect(
    screen.getByRole("list", { name: "How it was played" }).textContent,
  ).toBe("With Slate Owl");
});
