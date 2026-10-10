import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "7.2.6",
  date: "2026-09-24",
  summary: md(
    "Badges, war and rankings after the pre-beta Gym pass (feedback #337-#347), and the card vocabulary.",
    list(
      '`clans_roster.badge_count` is null for a member whose profile Elixir has not read, as years_played and lifetime already were: a newly tracked clan read "0 badges" for 44 of 49 members (#337). `lifetime.profile_observed_at` is the newest profile read, from the snapshot or the poll ledger (#338).',
      "`war_history` (in-progress week) and `war_rivals.current_race_fame` say the live week's fame is what was banked at the last war-day close, 0 until war day 1 closes (#340).",
      "`rankings_players` says when a full board's cutoff fell far below the previous snapshot's: the API served an incomplete board minutes after the 10:00Z reset on 2026-09-24, and today's three boards were re-read (#342). `rankings_clan_ladder.our_clan` says when the caller's clan is located outside a country board (it can never rank there), and an as_of read takes the clan's score from that date (#343, #344).",
      'cards_archetype resolves "Archer Queen" to the champion, not the unused tower-troop entry that shares the name (#324).',
    ),
    "Additive; badge_count can now be null.",
  ),
} satisfies ChangelogEntry;
