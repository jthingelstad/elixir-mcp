import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "8.1.0",
  date: "2026-09-24",
  summary: md(
    "Three trophy bands (Jamie, 2026-09-24), inside v8 by his call: `trophy_band` on battles_meta_decks, battles_meta_cards and cards_synergy is `under_10000`, `10000_13999` or `trophy_road_complete` (14,000 is Trophy Road's cap: the players who have finished it). The five bands before it split thin data finer than it holds: over 60 days, one deck under 10,000 trophies had two repeat players. `cards_card.by_band` follows.",
    list(
      "`trophy_road_complete` is war and friendlies: at 14,000 the ladder is Path of Legends, which carries no band. A note says so on every tool that takes the band, and on cards_card's by_band.",
      "`top_player_battles` rides rows with at most five REPEAT players (it was rows with 2-5 players): in the wider band a 98-battle deck had 16 players, only 2 of them repeat, and its busiest player went uncounted.",
    ),
  ),
  breaking:
    "A caller passing an old band name is now refused with the three names; no first-party client passes one.",
} satisfies ChangelogEntry;
