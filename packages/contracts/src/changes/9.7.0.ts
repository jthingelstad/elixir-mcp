import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.7.0",
  date: "2026-09-25",
  summary: md(
    "A new tool, `battles_deck_upgrades`: the other half of a war set, \"what should I upgrade so my four decks get better\". It starts from the player's best set of decks sharing no card today (the candidates, values and exact packing of `battles_deck_sets`) and prices two things by re-packing the set: single upgrades (a card raised toward the level the player fields, at most `max_levels` at a time, or an Evolution or Hero form unlocked that a candidate deck plays), and `within_reach`, the decks outside the set that would join it once each of their low cards reaches that level. Each says the set's value before and after (`gain`, in the same log-odds `battles_deck_sets` optimises), the levels it takes and the set it would give. Levels, not gold: the game's upgrade costs are not in the record.",
    list(
      "`battles_deck_upgrades`: `options` (kind `level` or `form`), `within_reach` (`raises`, `forms`, `levels`), `baseline`.",
    ),
    "Additive.",
  ),
  tools_added: ["battles_deck_upgrades"],
} satisfies ChangelogEntry;
