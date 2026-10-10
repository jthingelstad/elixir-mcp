import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.7.0",
  date: "2026-09-20",
  summary: md(
    "Deck archetypes, the last of the arc (design §5.1, §12.4).",
    list(
      "`cards_card` takes `archetype`: the decks carrying the card narrowed to a family, a composed label or a community name, by their stamp, before the top five are cut; `applied.archetype` echoes the resolution.",
      "Admin ▸ Cards on the console (`GET /api/admin/cards`, admins only, read-only): the catalog with each card's archetype role and its public source, the vocabulary version in force and the cr-agent-api-docs commit it was imported from, and the unattested queue - cards with no role that are the defining card of a deck named by cost alone this season. Nothing edits here; the file lives in the reference repository.",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
