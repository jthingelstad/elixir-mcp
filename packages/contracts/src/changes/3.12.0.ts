import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "3.12.0",
  date: "2026-09-18",
  tools_added: ["clans_timeline", "clans_members_timeline"],
  summary: md(
    "The daily series as readers (docs/reviews/2026-09-18-TIME-SERIES.md Part 7). Every daily series is keyed by the GAME day (10:00 UTC to 10:00 UTC, named for the date it starts on; docs: clocks#the-game-day), and every point carries its stamps: `observed_at`, `profile_observed_at` (null on a roster-only day), `roster_observed_at` (null when the roster never touched the row), `source` (`api` | `elixir-bot`) and `kind`.",
    list(
      "`players_timeline`: `metrics` grows to every column of the day row (`best_trophies`, `donations_received`, the lifetime block with `king_tower_level`, `total_donations` and the challenge and tournament counters, the Path of Legends standing, the seasonal trophies, `arena_id`, `clan_tag`, `clan_rank`, `previous_clan_rank`, `game_last_seen_at`); `kind`: `daily` | `pre_reset` | `season_roll`; `progress_key` (a `Player.progress` key or `'all'`) adds `progress[]`; `applied.window` carries the season fields; `docs` points at recording#daily-series.",
      "NEW TOOL `clans_timeline`: a clan's day series (`clan_score`, `clan_war_trophies`, `members`, `donations_per_week`, `required_trophies`) with the aggregates over that day's member rows (`total_member_trophies`, `avg_member_trophies`, `members_seen`) and, on request, the profile-derived ones (`avg_member_wins`, `avg_member_collection_level`, `members_12000_plus`, `members_14000_plus`, `members_6_years_plus`, `members_collection_1000_plus`); `series_available_from`; verbosity compact keeps the five clan metrics.",
      "NEW TOOL `clans_members_timeline`: every member the roster placed in the clan in the window (or `player_tags`, up to 50), one point per game day with the roster's metrics and any profile metric; `limit` on members with a maximum of 50; verbosity compact keeps each member's first and last point and the delta.",
      "`clans_roster` full verbosity gains per member `years_played`, `account_age_days`, `badge_count` and `lifetime {as_of, best_trophies, battle_count, wins, losses, three_crown_wins, collection_level, king_tower_level, total_donations}` from the latest profile poll, null for a member whose profile is not recorded.",
      "`rankings_timeline`'s description says what the record holds: one snapshot a day since 2026-09-11 and only when the board moved.",
      "`elixir_data_insights.players_with_snapshot` counts players with a profile snapshot.",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
