import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "13.9.0",
  date: "2026-11-17",
  summary: md(
    'The timeline says when a followed player first wins with a new card: "Pip won with Evo Musketeer for the first time."',
    list(
      "`elixir_timeline`: a new item kind, `card_first_win` (`battles` section; `facts.card`, `card_id`, `rarity`, `form` (`evolution` or `hero`, the form the card was played as; `null` for the card itself, in any form), `tower_troop`, and the winning `battle_id`). `at` is the winning battle. Written for a card, an Evolution or Hero form, or a tower troop the previous profile read did not show: the first win with it in the player's own deck (never a drawn deck, a boat battle or a duel) since that read, within 28 days of the read that showed it, once per card and form, never from a late capture and never for a new follow. Either read can complete it: the battle log after the profile, or the profile after the battle log, and `observed_at` is that read. On player and clan timelines.",
      "`ranked_season_finished`: a Master I finish whose Ranked battle the battle log delivered only after the rolled profile is said when that battle arrives, within 7 days of the season's end; still once per season.",
    ),
    "Additive. The JSON API is unchanged at 5.1.0.",
  ),
} satisfies ChangelogEntry;
