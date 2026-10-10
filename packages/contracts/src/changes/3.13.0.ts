import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "3.13.0",
  date: "2026-09-18",
  summary: md(
    "Every aggregate ships the control next to the number (feedback #54, #55, #56, #58, #59, #60: six wrong conclusions from correct data in one agent session).",
    list(
      "`battles_decks` rows carry `modes` (battles, wins, losses per mode group), `dominant_mode` and `dominant_mode_share`, `mean_level_gap`, `own_mean_level`, `opponent_mean_level` and `level_gap_battles`; the response carries `comparable`, false when the rows were played in different modes or at level gaps half a level apart, and a note then names the rows that clash.",
      "`battles_cards` rows carry `modes` (a count per mode group) and `mean_level_gap`; the response carries `modes_in_window` (battles and mean level gap per mode group) and `comparable`, with a note when modes with different matchmaking were pooled.",
      "`battles_levels.monthly_trend` points carry `actual_win_rate`, `expected_from_levels`, `mean_gap`, `opponent_mean_level`, `mean_starting_trophies` and `modal_arena {id, name}`; a note fires when the modal arena or the mean starting trophies moved between two points; a new `arena_id` argument holds the pool fixed; `methodology.n` says what n counts (the scored player's battles, once) and `methodology.adjusts_for` says the score adjusts for card levels, never opponent skill.",
      "`battles_performance` carries `trophy_floor` (`floor`, `arena`, `source`, `floored`, `on_floor_losses`, `losses_landing_on_floor`, `ladder_battles`, `trophy_range`) when the window holds ladder battles and the arena's floor is known, with a note when a loss touched it; `group_by: week` rows a window clips carry `partial: true` and `covers {from, to}`, with a note naming them.",
      "`battles_query` full verbosity: `elixir_leaked` on every teammate and opponent, `elixir_leaked_differential` on `me` (me minus the one opponent, null on duels, 2v2 and unreported sides), a note that neither is a skill measure, and a note when ladder losses carry `trophy_change` null (a loss ON the arena's floor).",
      "`war_current` and `war_history` say `decks_used` is the race week's cumulative count and a duel consumes one deck per round played.",
      "New error code `internal` for a server failure (it was reported as `bad_request`); a `result_too_large` hint says which limit would have fit.",
      "`battles_opponents` with any window failed since 3.11.1 (a SQL alias) and answers again.",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
