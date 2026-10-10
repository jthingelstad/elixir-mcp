import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.8.0",
  date: "2026-09-20",
  summary: md(
    "The resolver (design §5.2; Jamie, 2026-09-20: the product is still evolving, the tool-list weight is not the constraint).",
    list(
      "`cards_archetype`, three shapes, no population attached. `{ name }`: a family, a composed label or a community name to its family, win conditions, the aliases for that shape, a label, and `this_season` - how many recorded decks, battles and players carry that shape by the stamp. `{ cards }`: up to eight cards (ids or names; `Evo ` / `Hero ` prefixes set the form; tower troops ignored) to their archetype, pure - no record needed - with `in_the_record`: how many recorded identities have exactly that card set and their season. Neither: the vocabulary - families with definitions, the win conditions with tiers and families, bait units, bridge partners, aliases, and the grammar and vocabulary versions with the bounds in force.",
      "An unknown name is refused with the vocabulary in the hint; a card that is not in the catalog is refused by name.",
    ),
    "Additive.",
  ),
  tools_added: ["cards_archetype"],
} satisfies ChangelogEntry;
