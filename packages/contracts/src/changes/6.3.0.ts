import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.3.0",
  date: "2026-09-20",
  summary: md(
    "A name beside every tag the console had been showing bare. Three envelopes gain a last-observed name so a reader need not make a second call to say who a record is about.",
    list(
      "`battles_query`: top-level `name` beside `player_tag` when the call named one subject (the page's rows carry it; an empty page still names who), and `me.name` beside `me.player_tag` on each row when it did not (a battle by id, a deck across the corpus). Null when the record has no name for the tag.",
      "`battles_decks`: top-level `name` beside `player_tag`.",
      "`war_history`: top-level `name` beside `clan_tag`.",
      "`players_search`: each match carries `clan_name` beside `clan_tag` (null when the clan is unnamed or the player is in none).",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
