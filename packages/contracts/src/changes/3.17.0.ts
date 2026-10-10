import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "3.17.0",
  date: "2026-09-19",
  summary: md(
    "One grammar, one vocabulary (docs/reviews/2026-09-19-INTERFACE-REVIEW.md Part 2, Phase 4).",
    list(
      "Every windowed tool's `applied.window` says its season: `season` (the season the window starts in; null on an unbounded window), `crosses` (every season roll inside it, empty when clean) and `season_age_days`, on `battles_query`, `battles_performance`, `battles_decks`, `battles_cards`, `battles_opponents`, `battles_compare`, `clans_standings`, `battles_levels`, `clans_pilot_scores`, `clans_participation`, `rankings_timeline`, `game_events` and `elixir_timeline`, as the meta and series tools already carried them. The crossing note fires only when `crosses` is non-empty.",
      "The player battle tools and `clans_standings` take `season` (`'current'`, `'previous'`, `2026-08` or `135`), so \"this season\" is one argument on every tool that has a window; their default is unchanged.",
      "The series tools (`players_timeline`, `clans_timeline`, `clans_members_timeline`) accept an instant for `from`/`to` and floor it to its game day (10:00Z grid), echoing the instant under `applied.window.floored` with a note, where they refused it; `days: N` is N game days, today included.",
      "The one point vocabulary: `players_timeline` points carry `day` beside `date`; `rankings_timeline` points carry `day` (the snapshot's game day); `battles_levels.monthly_trend` marks the window's clipped months with `partial: true` and `covers {from, to}`, the weekly shape; `clans_participation` echoes `applied.window.source: 'default'` when `weeks` was defaulted and its notes say `war_points` is the period points figure; `game_events` carries `game_days_seen` beside `days_seen` (the same sightings on the game day grid; `days_seen` retires at 4.0.0), its `running_on_latest_day` is a fact of the table rather than of the window, and a date-only `to` no longer reaches one day past itself; `clans_roster.lifetime` carries `profile_observed_at` beside `as_of` (`as_of` retires at 4.0.0).",
      "`clans_pilot_scores` and `battles_levels.monthly_trend` take `mean_starting_trophies` over ladder battles only (a Path of Legends figure is a league rating on another scale; null with none), and say so.",
      "`players_summary.top_deck` and `best_deck` carry `mean_level_gap`, so the comparability note names real gaps.",
      "Descriptions: `players_timeline.metrics` names its four groups and the default; `battles_performance.group_by` says `mode` is the named game mode, not the group; `clans_members_timeline.limit` says the order and how to choose; `rankings_players` says `rating` is the profile's `pol_trophies`, verified equal on the live API.",
    ),
    "Additive; no migration.",
  ),
} satisfies ChangelogEntry;
