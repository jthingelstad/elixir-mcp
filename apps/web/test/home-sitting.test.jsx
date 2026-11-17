/**
 * A sitting's card (2026-11-16): a headline of its facts, its figures, the
 * facts worth a chip, its deck with a caption, and one link to its page.
 * One battle is a lighter card. Invented facts; no player.
 */
import { test, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import {
  Sitting,
  deckCaption,
  modesSaid,
  sessionChips,
  sessionHeadline,
  sessionLink,
} from "../src/home/Session.jsx";
import { gameMarks, ordinal } from "../src/home/session-games.js";

afterEach(cleanup);

const cards = Array.from({ length: 8 }, (_, i) => ({
  id: 26000000 + i,
  name: `Card ${i}`,
  form: i === 0 ? "hero" : "base",
  elixir_cost: i + 1,
}));

test("the headline says the sitting from its facts", () => {
  expect(
    sessionHeadline({
      battles: 12,
      won: 8,
      won_in_a_row: 5,
      by_mode: { ladder: 12 },
    }),
  ).toBe("Won 8 of 12 on Trophy Road, 5 in a row");
  expect(
    sessionHeadline({ battles: 5, won: 2, by_mode: { ladder: 3, ranked: 2 } }),
  ).toBe("Won 2 of 5 across Trophy Road and Ranked");
  expect(
    sessionHeadline({
      battles: 6,
      won: 5,
      won_in_a_row: 2,
      by_mode: { event: 6 },
      events: [{ name: "Classic 1v1", battles: 6 }],
    }),
  ).toBe("Won 5 of 6 in Classic 1v1");
  expect(sessionHeadline({ battles: 1, lost: 1, by_mode: { ladder: 1 } })).toBe(
    "Lost a Trophy Road battle",
  );
  expect(sessionHeadline({ battles: 1, won: 1, by_mode: { ranked: 1 } })).toBe(
    "Won a Ranked battle",
  );
  expect(sessionHeadline({ battles: 3, won: 0 })).toBe("3 battles");
  expect(
    sessionHeadline({
      battles: 1,
      won: 1,
      by_mode: { event: 1 },
      events: [{ name: "Classic 1v1", battles: 1 }],
    }),
  ).toBe("Won a battle in Classic 1v1");
  expect(modesSaid({ by_mode: { event: 2 }, events: [] })).toBe("Events");
});

test("chips are facts: a run of three, three-crown wins, the widest win", () => {
  expect(
    sessionChips(
      { battles: 12, won_in_a_row: 5 },
      { best_win: "3-0", three_crowns: 3 },
    ).map((c) => c.text),
  ).toEqual(["3 three-crown wins", "Best win 3-0"]);
  expect(sessionChips({ battles: 4, won_in_a_row: 2 }, null)).toEqual([]);
  // One battle says its result in the headline; no chips.
  expect(
    sessionChips({ battles: 1 }, { best_win: "3-0", three_crowns: 1 }),
  ).toEqual([]);
});

test("the caption names the deck played most and how many others", () => {
  expect(
    deckCaption({
      battles: 12,
      decks: [
        { label: "Hog Rider cycle", battles: 8 },
        { label: "Giant beatdown", battles: 4 },
      ],
    }),
  ).toEqual({
    label: "Hog Rider cycle",
    count: "8 of 12 battles",
    more: "+1 more deck: Giant beatdown (4)",
  });
  expect(
    deckCaption({
      battles: 1,
      decks: [{ label: "Golem beatdown", battles: 1 }],
    }),
  ).toEqual({ label: "Golem beatdown", count: null, more: null });
  expect(deckCaption({ battles: 2, decks: [] })).toBeNull();
});

test("the card is one link to the session's page, with its deck's eight cards", () => {
  const it = {
    id: "tl_abc",
    kind: "battle_session",
    facts: {
      battles: 4,
      won: 3,
      lost: 1,
      trophy_net: 40,
      by_mode: { ladder: 4 },
      decks: [{ label: "Invented cycle", battles: 4 }],
      started_at: "2026-11-10T14:00:00.000Z",
    },
    deck: { label: "Invented cycle", cards },
    evidence: { kind: "session", version: "ev_1" },
  };
  const href = sessionLink(it, "#00C298UC");
  expect(href).toBe(
    "/home/player/00C298UC/session/tl_abc?at=2026-11-10T14%3A00%3A00.000Z",
  );
  render(<Sitting it={it} href={href} who="<b>Quill</b>" />);
  const link = screen.getByRole("link", {
    name: "Open <b>Quill</b>’s session: Won 3 of 4 on Trophy Road, lost 1, +40 trophies",
  });
  expect(link.getAttribute("href")).toBe(href);
  const row = link.querySelector("ul.kit-deckrow");
  expect(row.querySelectorAll("li")).toHaveLength(8);
  expect(row.querySelectorAll(".kit-deckrow__cost")[7].textContent).toBe("8");
  expect(document.querySelector("b")?.textContent).not.toBe("Quill");
  // A deck kept for another label (an old row) is not drawn, and an item
  // with no evidence has no page.
  cleanup();
  render(<Sitting it={{ ...it, deck: { label: "Other", cards } }} />);
  expect(document.querySelector("ul.kit-deckrow")).toBeNull();
  expect(screen.queryByRole("link")).toBeNull();
  expect(sessionLink({ ...it, evidence: null }, "#00C298UC")).toBeNull();
});

test("one battle is lighter: no figures and no strip", () => {
  render(
    <Sitting
      it={{
        kind: "battle_session",
        facts: {
          battles: 1,
          lost: 1,
          trophy_net: -28,
          by_mode: { ladder: 1 },
        },
        spark: [{ r: "l", m: 1 }],
      }}
    />,
  );
  expect(screen.getByText("Lost a Trophy Road battle")).toBeTruthy();
  expect(screen.getByText("−28 trophies")).toBeTruthy();
  expect(document.querySelector(".kit-sfacts")).toBeNull();
  expect(document.querySelector(".kit-spark")).toBeNull();
});

test("games that mattered: three crowns, the win that ended a run, the server's moments", () => {
  expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 103].map(ordinal)).toEqual([
    "1st",
    "2nd",
    "3rd",
    "4th",
    "11th",
    "12th",
    "13th",
    "21st",
    "22nd",
    "103rd",
  ]);
  // Played order: L W W W W L W; the page is newest first.
  const spark = ["l", "w", "w", "w", "w", "l", "w"].map((r) => ({ r, m: 1 }));
  const battles = spark
    .map((s, i) => ({
      battle_id: `b${i}`,
      outcome: s.r === "w" ? "win" : "loss",
      crowns: i === 2 ? 3 : 1,
    }))
    .reverse();
  const marks = gameMarks(battles, {
    spark,
    count: 7,
    offset: 0,
    marks: [{ battle_id: "b4", label: "New best: 7,512 trophies" }],
  });
  expect(Object.fromEntries(marks)).toEqual({
    b2: ["Three crowns"],
    b4: ["New best: 7,512 trophies", "4th win in a row"],
  });
  // The second page lines up by its offset.
  const older = gameMarks(battles.slice(2), { spark, count: 7, offset: 2 });
  expect(older.get("b4")).toEqual(["4th win in a row"]);
  // A strip that does not hold every game says no run.
  expect(
    gameMarks(battles, { spark: spark.slice(1), count: 7 }).get("b4"),
  ).toBeUndefined();
});
