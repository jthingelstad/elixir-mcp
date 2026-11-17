import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "13.10.0",
  date: "2026-11-17",
  summary: md(
    "A followed player's timeline carries their own clan news: a promotion, and their war week at its close.",
    list(
      "`elixir_timeline`: `member_role_changed` is now also on a player's own timeline, for promotions only: the clan's item about them, under the clan's story id, so a reader who follows the player and the clan reads it once. A demotion stays on the clan's timeline only.",
      "`elixir_timeline`: a new item kind, `war_week_played` (`war` section; `facts.clan_tag`, `clan_name`, `season_id`, `section_index`, `is_colosseum`, `decks_used`, `points`). `at` is the clan's `week_resolved`. On the player's timeline only, for a clan the record watches, when the player used at least one war deck that week; weekly aggregates only, never a day, and points, never fame.",
    ),
    "Additive. The JSON API is unchanged at 5.1.0.",
  ),
} satisfies ChangelogEntry;
