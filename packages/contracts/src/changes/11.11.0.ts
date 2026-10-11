import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.11.0",
  date: "2026-10-11",
  summary: md(
    "Timeline moments carry more of how they happened, and a moment proved late comes back as the same story.",
    list(
      'elixir_timeline session_standout (schema version 3): teammate {player_tag, name, battles} when the sitting was played with a partner in 2v2, and best_win {battle_id, battle_time, type, mode, opponent or opponents (each with starting_trophies), crowns, crowns_against, trophy_change, trophies_after?}, the win over the opponent who started it with the most trophies. Each crossing names the battle that crossed it (battle_id). The text says "with <name> in 2v2" and names the best win, and follow adds a battles_query for it. Two clanmates\' 2v2 sittings stay two items.',
      "elixir_timeline: a promotion, new best or other crossing proved after it was first served (promoted_by) comes back under the same id at a higher revision, its evidence's attachment_revision. Before, it came back at revision 1 and read as new.",
      "elixir_timeline week_resolved: the text names the week's top three members by points, with the decks each used. The facts are unchanged; points, never per-member fame.",
      "award_standing facts are written for the season running only. A closed season's places were written as standings beside its award_granted result and read as \"now leads\"; they are taken back at the next morning's standings.",
    ),
    "Additive. JSON API 3.2.0 is unchanged.",
  ),
} satisfies ChangelogEntry;
