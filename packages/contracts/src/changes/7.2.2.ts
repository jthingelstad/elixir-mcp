import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "7.2.2",
  date: "2026-09-24",
  summary: md(
    "The pre-beta Gym pass, first fixes (feedback #314-#316).",
    list(
      "The API reports no tower troop on river race (war) battles. `battles_meta_cards` with `tower_troops: true` serves `tower_troop_known_battles` and takes each tower troop's `usage_share` over it, so a war player's shares are no longer 10-40 points low; `decided_battles` stays the eight-card read's number, including on `mode: war`, where it had read 0. `cards_card` on a tower troop carries the same count and note (#315).",
      "`game_events` says its first/last sighting fields are the record's whole span, bounded by gaps between reads, not the window's.",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
