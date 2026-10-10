import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "4.0.0",
  date: "2026-09-19",
  summary: md(
    "The batched major (docs/reviews/2026-09-19-INTERFACE-REVIEW.md Part 5.3, Phase 6): the names and shapes the additive releases 3.14.0 to 3.18.0 doubled are settled to one, with no deprecation window (every client of this server is first-party and was updated in the same pass).",
    "Nothing new is served; every retired name has its replacement under breaking. The first call after reconnecting should re-fetch `tools/list`: `elixir_feedback` is `elixir_send_feedback`, and the six segment tools refuse a call without `segment`.",
  ),
  breaking: list(
    "`players_timeline.series[].date` removed (`day`, the same YYYY-MM-DD game day, 3.17.0).",
    "`battles_query.battles[].arena` is `{id, name}` (was the name string; `arena_id` folded in).",
    "`players_profile.snapshot.lifetime` carries the snake_case keys only (`battle_count`, `wins`, `losses`, `three_crown_wins`, `star_points`, `exp_points`, `collection_level`, ...); the camelCase twins `battleCount`, `bestTrophies`, `threeCrownWins`, `starPoints`, `expPoints`, `collectionLevel` are gone. One shape with `clans_roster` and `players_timeline`.",
    "`battles_performance` `group_by: 'mode'` removed (`game_mode` is the named game mode; `week` unchanged).",
    "`clans_standings.members[].trophy_net` removed (`net_trophies`, the name `battles_performance` uses).",
    "The series' `pol_league` metric (`players_timeline`, `clans_members_timeline`) is `league_number`, the battle row's name: the `metrics` argument accepts `league_number` and refuses `pol_league`, and the point carries `league_number` (the profile's `path_of_legend` object keeps the API's own `leagueNumber`).",
    "`clans_participation.weeks[].complete` removed (`partial`, true on the current week, the shape the weekly and monthly buckets use).",
    "`elixir_coverage.completeness_last_7_days.average_ratio` is a number (was a three-decimal string) and `incomplete_days` (always null) removed.",
    "`war_current.nominal_period_elapsed` removed (`period.started_at` and `day_ends_at` say the same).",
    "`game_events.events[].days_seen` removed (`game_days_seen`, 3.17.0).",
    "`clans_roster.members[].lifetime.as_of` removed (`profile_observed_at`, the same instant).",
    "`segment` is REQUIRED on `battles_meta_decks`, `battles_meta_cards`, `battles_trends`, `cards_synergy`, `badges_rarity` and `badges_holders`: a call without it is `bad_request` (class `input`) with a hint naming `'mine'`, `'corpus'` and the object; the omitted-segment note is gone with the default.",
    "`elixir_feedback` is `elixir_send_feedback` (the write-tool naming rule; `elixir_my_feedback` unchanged).",
  ),
} satisfies ChangelogEntry;
