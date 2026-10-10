import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.5.0",
  date: "2026-09-20",
  summary: md(
    'Deck archetypes (docs/reviews/2026-09-20-DECK-ARCHETYPES-DESIGN.md; Jamie, 2026-09-20: players talk about decks by name, and Elixir has to name a deck and know what a name means). Every deck object now carries `archetype` - the deck\'s family (beatdown, control, cycle, bait, bridge_spam, siege; unclassified when no card carries a cost), its win condition(s) with form, a descriptive label composed as `<win condition(s)> <family>` ("Evo Royal Hogs bridge spam", "Hog Rider cycle", "Lava Hound Balloon beatdown"; the bare family when no attested win condition is in the deck), the average elixir, the basis, and two versions: the grammar\'s and the vocabulary\'s. A label is a noun, never a verdict: no matchup, no expected advantage, no quality claim, and none coming.',
    list(
      "`archetype` rides `battles_query` (every rendered deck and duel round), `battles_decks`, `battles_meta_decks` (`decks[]` and `unfieldable[]`), `cards_card.decks` and `players_summary` (`top_deck`, `best_deck`), with one note per response saying what a label is and is not.",
      "`battles_meta_decks` and `battles_decks` take `archetype`: a family, a composed label, or a community name (LavaLoon, Log Bait, 2.6 Hog, Hog EQ, Splashyard, PEKKA Bridge Spam...). Resolved alias first, then family, then label (card names as typed, `pekka` included; an evo/hero prefix ignored); `applied.archetype` echoes the resolution and a note names it; an unknown name is refused with the vocabulary in the hint. Applied over the rows the call would return (the meta reader labels its top 2,000 by the sort), denominators unchanged.",
      "Grammar in code, vocabulary in data: the rules are in the contract package (`classifyDeck`, `resolveArchetypeName`, `GRAMMAR_VERSION`, `CYCLE_MAX`); which cards are win conditions, bait units and bridge partners is cr-agent-api-docs `data/card-roles.json` and `data/deck-aliases.json`, one public source per entry, imported at deploy (`card_role`, `deck_alias`, `card_role_version`; migration 0147) and versioned by the file's commit time. A card absent from the file is not a win condition; the docs page names the unattested cards and the domain's research agent keeps the file. Not bound to the season: history is relabelled when the vocabulary improves.",
      "The docs page `archetypes` carries the families with their sources, the grammar, the cycle bound and how it is measured, and the resolution rules; the `archetype_census` operator read runs the grammar over every recorded deck (family distribution, the unclassified share, the top labels, the average-elixir histogram per win condition, the unattested queue).",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
