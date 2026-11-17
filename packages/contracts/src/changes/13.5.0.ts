import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "13.5.0",
  date: "2026-11-17",
  summary: md(
    "The timeline tells more of what a player's profile already shows: a card maxed, a King Tower level, a best challenge run, a 12-win challenge run, Years Played and every level of a tiered badge. A day of one player's Mastery badges is one item, and a sitting says its three-crown and overtime wins.",
    list(
      "`elixir_timeline`: four new item kinds, each a change between two profile reads and never a player's first one. `card_maxed` (`collection` section; `facts.card`, `card_id`, `rarity`, `level`), `king_tower_leveled` (`collection`; `level`, `prior_level`), `challenge_best_run` (`battles`; `best`, `best_before`), `twelve_win_run` (`battles`; `badge`, `badge_label`, `challenge`, `runs`, `runs_before`, and `level`/`prior_level` when the badge's tier rose). `badge_earned` schema 3: a Mastery badge is told when a level-up crosses a multiple of five or its top level (a jump from 3 to 6 crosses 5), any other tiered badge at every level; one story per badge a UTC day at its latest level, and one per player's Mastery badges a UTC day, which then carries `badges[]` (each `{badge, badge_label, level, prior_level}`, highest first, at most 10) and `badge_count`, with `badge`, `badge_label` and `level` its highest. Years Played reads \"has played Clash Royale for 5 years\". Battle Wins, Collection Level, the ladder rankings and the 12-win badges are never `badge_earned` items. `battle_session` schema 5 and `session_standout` schema 6: `facts.three_crown_wins` (wins that took the King Tower; never a duel's summed games or a boat battle) and `facts.overtime_wins` (wins the tiebreaker decided at the end of overtime, crowns level) when at least one.",
    ),
    "Additive. The JSON API is unchanged at 5.1.0.",
  ),
} satisfies ChangelogEntry;
