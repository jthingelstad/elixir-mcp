import { md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.8.1",
  date: "2026-09-26",
  summary: md(
    'The war-deck docs have their own page, `war-decks` (sections `deck-sets` and `deck-upgrades`), and `battles_deck_sets` and `battles_deck_upgrades` point there. With 9.8.0\'s text the battle model page had grown past the 48,000-character result cap, so `elixir_docs({ page: "battles" })` was refused.',
  ),
} satisfies ChangelogEntry;
