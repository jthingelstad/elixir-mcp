/** Help for Ladder's four tabs. */
export const LADDER_HELP = {
  season: {
    title: "Season",
    docs: "ladder:season",
    lines: [
      "Season is one player's season in one game mode, from the battles Elixir recorded. The scope bar chooses the player, the mode and the season.",
      "A day with no recorded battles is unknown unless the log was read that day.",
    ],
  },
  battles: {
    title: "Battles",
    docs: "ladder:battles",
    lines: [
      "Battles lists the recorded battles in this scope, newest first. Each opens to its decks and its result.",
    ],
  },
  decks: {
    title: "Decks",
    docs: "ladder:decks",
    lines: [
      "Decks counts the decks this player used in this scope. A deck is exactly its eight cards, named by archetype. A name is a label, not a verdict.",
    ],
  },
  cards: {
    title: "Cards",
    docs: "ladder:cards",
    lines: [
      "Cards counts the cards this player used and the cards they faced, in this scope. Rates are facts about these battles, not advice.",
    ],
  },
};
