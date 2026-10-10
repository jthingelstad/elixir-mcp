import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "3.16.0",
  date: "2026-09-19",
  summary: md(
    "The control next to every number (docs/reviews/2026-09-19-INTERFACE-REVIEW.md Part 4, Phase 3): every tool that serves a rate, trend, rank or sum carries the control the 3.13.0 principle names, and a note fires only on a detected confound.",
    list(
      "`players_summary`: `last_30_days.modes` (the window's battles by mode group); `top_deck` and `best_deck` carry `modes` and `dominant_mode`; `trophy_floor` when the window holds ladder battles; the deck comparability note and the floor note.",
      "`clans_standings` members carry `modes`, `ladder_battles`, `mean_level_gap` and `level_gap_battles`, `log_recorded` and `recorded_since`; the response carries `comparable` (false when two ranked members' dominant modes differ or their gaps are half a level apart, the note naming them) and `basis` (`recorded` | `roster_and_war_only`). `trophy_net` reads null when `ladder_battles` is 0, where it read an ambiguous 0 before (a field the docs never defined as a sum-or-zero).",
      "`battles_trends` weeks carry `modes` (the week's battles by mode group) and, when the window clips a week, `partial: true` with `covers {from, to}` and a note; a pooled-modes note fires when `mode` was omitted and a week holds more than one group.",
      "`battles_meta_decks` and `battles_meta_cards` rows carry `modes` and `mean_level_gap` (deck rows `level_gap_battles` and `dominant_mode` too); the response carries `comparable`, `modes_in_window` when `mode` was omitted, the pooled-modes note, and on a segment read a note when every returned row is one player's.",
      "The three meta tools take `trophy_band` (`under_5000`, `5000_8000`, `8000_11000`, `11000_13000`, `13000_plus`: the observation's own player's starting trophies), answered from a banded season rollup once the nightly rebuild has filled it and from the raw rows with a note before; `cards_synergy`'s anchor carries `modes`.",
      "`clans_pilot_scores` members carry `mean_starting_trophies`, `modal_arena {id, name}` (the population they were scored in) and `current_arena`, with a note naming the members whose modal arena inside the window differs from their current one.",
      "`clans_participation` members carry `log_recorded`, `recorded_since`, `last_battle_time_in_clan` and `war_days_battled` (per war week, null without coverage); the response carries `basis` (`recorded` | `roster_and_war_only`) and the activity-scope note.",
      "`clans_timeline` gains the `members_with_profile` aggregate (the denominator of the profile-derived ones); `war_rivals` rows carry `colosseum_races` with a note when any; `rankings_timeline` notes when `rated_players` is 0 at every point (an empty field, not a flat one); `rankings_clans` carries `field_size` (the placed players the counts were taken over).",
      "The population is named (product call 5): on the six segment tools (`battles_meta_decks`, `battles_meta_cards`, `battles_trends`, `cards_synergy`, `badges_rarity`, `badges_holders`) `segment` also accepts the strings `'mine'` (the caller's clan; `no_subject` when there is none) and `'corpus'` (the whole recorded corpus, explicitly). The corpus is one population among the others, never a default: a read that omits `segment` still answers it, carries a note saying so (that note only), and a corpus read carries `population {recorded_clans, recorded_players, players_in_window}`. 4.0.0 makes `segment` required.",
    ),
    "Additive; migration 0135 adds the band tables and the level-gap columns, empty, filled nightly.",
  ),
} satisfies ChangelogEntry;
