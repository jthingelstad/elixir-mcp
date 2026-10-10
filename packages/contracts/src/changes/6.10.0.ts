import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.10.0",
  date: "2026-09-20",
  summary: md(
    "A card that names a deck without being its win condition (the Rune Giant read). Some decks have no building-targeter at all - the tower damage is chip from enchanted or support troops behind a tank - and the deck sites lead the name with the tank: 'Rune Giant beatdown'. The wiki says exactly that of Rune Giant and the guides say it is not a win condition; both are now true in the data.",
    list(
      '`archetype.named_by` on every deck object and on `cards_archetype`: with no win condition in the deck, the card the label leads with (`{ id, name, form }`), null otherwise. `win_conditions` stays empty on such a deck - the card is not one and never anchors over one. The stamp carries the naming card, so `archetype: "rune giant beatdown"` filters and `group_by` folds it like any other label.',
      "Vocabulary: `names_deck` (cr-agent-api-docs `7bd537b`), Rune Giant the only entry; the reference's validator refuses a card that is both a win condition and a namer. The unattested queue no longer counts a named deck as nameless.",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
