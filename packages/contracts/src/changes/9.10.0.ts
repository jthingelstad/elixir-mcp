import { md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.10.0",
  date: "2026-09-26",
  summary: md(
    '`battles_deck_sets` takes `exclude_decks`: `deck_hash` values no set may choose (any variant names the same eight cards; `candidates.excluded_decks` counts them), so "a different last war deck" is the other three locked and the current fourth excluded. Read back through a clan\'s agent at 9.9.1, the search free to choose any fourth deck chose the one the player already plays, and the agent offered it as new.',
  ),
} satisfies ChangelogEntry;
