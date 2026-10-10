import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.9.0",
  date: "2026-09-20",
  summary: md(
    "The debug pass: a few hundred recorded decks read beside their labels (the `{archetype_sample}` operator read), and what it changed.",
    list(
      "`archetype.secondary_win_conditions[]` on every deck object and on `cards_archetype`: every other attested win condition in the deck, by priority - what the label leaves out, so an agent can say 'Miner control, with Goblin Barrel and Boss Bandit' without reading the cards.",
      "Vocabulary (cr-agent-api-docs `130a770`): Minion Giant (a building-targeting win condition; the most-played nameless deck of the season was 2.6 Hog's eight with Minion Giant in the Hog slot) and Goblinstein (a win condition below the classic chip cards) are attested from public sources; Giant pairs with Sparky ('Giant Sparky'); Wall Breakers is cycle only at cycle cost; Ronin, Boss Bandit and Elite Barbarians are bridge spam only with a bridge partner beside them, else control; the chip and bridge win conditions are ordered within their tier rather than tied by card id; Rune Giant is declined with its public reason. Aliases: Giant Sparky, Mortar Bait.",
      "Labels moved on re-stamp accordingly; a deck's history is relabelled on purpose.",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
