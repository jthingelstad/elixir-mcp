import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "3.15.0",
  date: "2026-09-19",
  summary: md(
    "The record reaches the wire (docs/reviews/2026-09-19-INTERFACE-REVIEW.md Part 1.3, Phase 2): every collected column an agent would ask about is served on the tool that owns the question, no migration.",
    list(
      "`battles_query` rows carry `mode_group` (the contract's fold of `type`) and, at full verbosity, `context {event_tag, tournament_tag, ladder_tournament, hosted, deck_selection}` and on a `boatBattle` row `boat {side, towers_before, towers_after, remaining}`; compact carries `deck_selection` at the top level.",
      "`war_history` with `season_id` and `section_index` carries `days[]` (the race's own day-by-day from the API's `periodLogs`: per closed war day every clan's `points_earned`, `progress_start`, `progress_end`, `progress_earned`, `end_of_day_rank`, `defenses_remaining`, `progress_from_defenses`) and `standings[]` (every clan in the bracket with `clan_score` and `repair_points`); `weeks[]` carry `closed_at` (the API's own close instant) beside `finished`, plus `our_clan_score` and `our_repair_points`; `member_weeks[]` carry `repair_points`.",
      "`war_current` carries `days_closed[]` in the same shape (full verbosity), `clan_score` and `repair_points` on `standings[]`, `repair_points` per participant, and `period.api_period_type` (the API's own word for the day). `war_rivals` rows carry `clan_score`, latest observed.",
      "`players_profile.snapshot.path_of_legend.seasons[]` lists the last twelve season finals the record kept (`{season_month, league, trophies, rank}`, newest first); `players_profile.attributes` and `clans_roster.lifetime` carry `war_day_wins`, `clan_cards_collected` and `legacy_trophy_road_high_score`.",
      "`clans_roster` carries the clan's `type`, `location_id` and `description` at both verbosities; `clans_timeline`'s `metrics` enum gains `type` and `location_id` (asked for, never default).",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
