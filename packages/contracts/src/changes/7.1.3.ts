import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "7.1.3",
  date: "2026-09-24",
  summary: md(
    "The war and player tools after the Elixir Gym's third run on them (feedback #223-#235).",
    list(
      "`war_rivals` serves effort beside fame: `mean_points` per finished week from the day logs, `points_weeks`, and `points_vs_ours`, the rival's points over yours across the weeks the record holds both. Fame pays for placement, so a rival at 60% of your fame had played about 5% of your points (#226).",
      "A week's `clan_war_trophies` is the figure going into the race wherever the race log filled it: the log's clanScore is after the race, and two Colosseum weeks read 100 high. Ingest subtracts the week's change and migration 0165 repairs the rows whose chain proves it (#224).",
      "The `clan_score` deprecation says the next major version instead of a 7.0.0 that shipped without it, the default `war_history` read says it too, and the war docs name `our_clan_war_trophies` and describe `finished` as the close instant it is (#225). #223 (a day-4 finish read the capped 10,000) shipped in 7.1.2.",
      "`players_timeline`, `clans_timeline` and `clans_members_timeline` take `season`, and a season that has not begun is its start day with a note, where `players_timeline` had served a window ending before it began (#228).",
      "The seasonal Trophy Road's entry value (14,000 with best 0) is not progress: ingest writes no row for it and migration 0166 removes the stored ones; a 1,539-trophy account had read as standing at 14,000 (#229).",
      "A `progress_key` that matches none of the player's buckets says so and lists the keys the record holds, naming the right case when only the case was wrong (#230).",
      "The pre_reset donations note calls the figure what it is: the highest weekly counter the record read, a lower bound on the week's total (#231).",
      "`players_collection` sets its upgrade target against the level fielded now when that differs, declares `fielded.recent_mean_level`, and describes `count`; `players_summary` declares `best_deck.dominant_mode` and `mean_level_gap` (#232, #234).",
      "`players_profile` serves `snapshot.lifetime.king_tower_level` and `total_donations`, and says what a null `years_played` means (#233).",
    ),
    "Additive; stored war trophies and seasonal progress rows change where the source was wrong.",
  ),
} satisfies ChangelogEntry;
