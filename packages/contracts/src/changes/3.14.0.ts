import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "3.14.0",
  date: "2026-09-19",
  summary: md(
    "The fourteen verified defects of the interface review (docs/reviews/2026-09-19-INTERFACE-REVIEW.md), Phase 1.",
    list(
      "`war_history` with `season_id` and `section_index` answers the whole week's roster (up to 60 `member_weeks`) in one pass instead of timing out the Lambda; it is under the analytical query budget, and every read-only tool now races the Lambda's own deadline, so a call that would have died as a bare HTTP 500 answers `query_timeout` with `meta.request_id` and an audit row.",
      "`war_current.next_war_day_opens_at` (top level and in `period`) is the next war day to open after the current period on war days too, equal to `game_clock`'s at the same instant; it was null on every war day.",
      "`war_history.history_starts_at` is the oldest war week the record holds for the clan whatever window was asked for (it was the window's own oldest row).",
      "`battles_query` rows carry `arena_id` beside `arena` (the name; the docs said id), null on a row the 0131 backfill never reached.",
      "`clans_standings` ranked members carry `percentile` (`1 - (rank - 1) / ranked_members`, the formula the note always stated).",
      "`players_profile.snapshot.lifetime` carries the snake_case keys (`battle_count`, `three_crown_wins`, `star_points`, `exp_points`, `collection_level`) beside the camelCase ones with equal values: one lifetime shape with `clans_roster` and `players_timeline`; the camelCase set is retired at 4.0.0.",
      "A `live_pending` refusal carries `error.retry_after_s` as an integer beside the hint (a consumer regexed the seconds out of the English).",
      "`clans_timeline`'s `members_seen` note says the count includes members who left that day and can read above `members`.",
      "`meta.completeness_note` fires: on a player subject whose window ends inside the last seven days, when the newest profile interval (the two latest profile polls and the recorded battles between them) reads under 0.9, or is not comparable with more than 48 hours since the last profile poll; it names the counts and points at `elixir_coverage`. It was promised by the instructions and the docs and set by nothing.",
      "`rankings_timeline`'s description says one snapshot a day since the afternoon of 2026-09-11 (that day holds sixteen).",
      "Six descriptions over the 600-character convention (`elixir_timeline`, `players_timeline`, `clans_roster`, `war_current`, `clans_participation`, `battles_query`) are trimmed to what they are, their default, what compact drops and the one caveat; what moved is on the docs page each tool's docs pointer names, and the registry test now holds the line at 600.",
      "`elixir_coverage.completeness_last_7_days.average_ratio` is documented as the string it is (three decimals) until 4.0.0 makes it a number.",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
