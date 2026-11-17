/**
 * The profile moments' sentences (the owner, 2026-11-17): facts only,
 * sentence case, no exclamation marks. "Pip" is the stand-in name.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { itemText } from "../src/activity/summary.mjs";

const said = (kind, facts) =>
  itemText({ kind, subject_name: "Pip", facts: { name: "Pip", ...facts } });

test("a maxed card, a King Tower level, a best run, a 12-win run", () => {
  assert.equal(
    said("card_maxed", { card: "Hog Rider", card_id: 26000021 }),
    "Pip maxed Hog Rider.",
  );
  assert.equal(
    said("king_tower_leveled", { level: 15, prior_level: 14 }),
    "Pip reached King Tower level 15.",
  );
  assert.equal(
    said("challenge_best_run", { best: 9, best_before: 7 }),
    "Pip's best challenge run is now 9 wins.",
  );
  assert.equal(
    said("twelve_win_run", {
      badge: "Grand12Wins",
      challenge: "Grand Challenge",
      runs: 6,
      runs_before: 5,
    }),
    "Pip won 12 in Grand Challenge.",
  );
  assert.equal(
    said("twelve_win_run", {
      badge: "Classic12Wins",
      challenge: "Classic Challenge",
      runs: 3,
      runs_before: 1,
    }),
    "Pip won 12 in Classic Challenge 2 times.",
  );
  // A badge new on the profile: its first run.
  assert.equal(
    said("twelve_win_run", {
      badge: "Classic12Wins",
      challenge: "Classic Challenge",
      runs: 1,
      runs_before: null,
    }),
    "Pip won 12 in Classic Challenge.",
  );
});

test("Years Played is the years; a Mastery roll-up is one line by level", () => {
  assert.equal(
    said("badge_earned", { badge: "YearsPlayed", level: 5 }),
    "Pip has played Clash Royale for 5 years.",
  );
  assert.equal(
    said("badge_earned", { badge: "YearsPlayed", level: 1 }),
    "Pip has played Clash Royale for 1 year.",
  );
  const m = (badge, level) => ({ badge, level });
  assert.equal(
    said("badge_earned", {
      badge: "MasteryHogRider",
      level: 5,
      badges: [
        m("MasteryHogRider", 5),
        m("MasteryKnight", 5),
        m("MasteryMinions", 5),
        m("MasteryGoblins", 5),
      ],
      badge_count: 4,
    }),
    "Pip reached Mastery level 5 with 4 cards.",
  );
  assert.equal(
    said("badge_earned", {
      badge: "MasteryHogRider",
      level: 10,
      badges: [
        m("MasteryHogRider", 10),
        m("MasteryKnight", 5),
        m("MasteryMinions", 5),
        m("MasteryGoblins", 5),
      ],
      badge_count: 12,
    }),
    "Pip reached Mastery level 10 with 1 card and level 5 with 3 cards, and 8 more cards.",
  );
  // One badge says it as it always did.
  assert.equal(
    said("badge_earned", { badge: "MasteryHogRider", level: 5 }),
    "Pip took Hog Rider Mastery to level 5.",
  );
});

test("a sitting says its three-crown and overtime wins", () => {
  const text = said("battle_session", {
    battles: 4,
    won: 3,
    lost: 1,
    drawn: 0,
    by_mode: { ladder: 4 },
    trophy_net: 30,
    three_crown_wins: 2,
    overtime_wins: 1,
  });
  assert.match(text, /; 2 three-crown wins, 1 overtime win\)/);
  const none = said("battle_session", {
    battles: 2,
    won: 1,
    lost: 1,
    drawn: 0,
    by_mode: { ladder: 2 },
  });
  assert.doesNotMatch(none, /three-crown|overtime/);
});
