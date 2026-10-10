import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "1.5.0",
  date: "2026-09-11",
  summary:
    "The season finals were filed under the wrong season numbers, and eight were missing. 1.4.0 fetched a final by a bare number and took that number for the season game_clock counts (S136 = September 2026); it is the position in the API's own seasons list, eight higher - what was labelled S135 was the December 2025 final, and January through August 2026 were never fetched. Every held final is relabelled (S97..S135 became S89..S127), the missing eight are on the schedule, and the finals are fetched by the API's own name for a season from now on. NEW: rankings_players and rankings_clans with board pol_final accept season as that name too - the month the season started in, 2026-08 - beside the number; the snapshot block carries season_month so both spellings come back, and game_clock says season_month beside season_id. The three season namespaces, for the record: game_clock's number (S136 now), the in-game Pass number (Season 87, which the API does not know), and the API's YYYY-MM.",
} satisfies ChangelogEntry;
