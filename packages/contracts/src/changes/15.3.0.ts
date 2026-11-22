import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "15.3.0",
  date: "2026-11-22",
  // What an agent must know: a lede paragraph, one bullet per tool, then
  // the closing line (Additive, or what changed for the JSON API). Add
  // tools_added for a new tool and breaking for a major. The changelog
  // test fails while this is empty.
  summary: md(
    "elixir_timeline adds week_form, a player's closed game week set beside the four game weeks before it in one mode, told only when the win rate rose at least ten points.",
    list(
      "elixir_timeline: kind week_form (schema week_form/1, section battles, player entries only, never a clan's) at the game week's end (Monday 10:00 UTC), when both sides have at least 10 decided battles and the week's win rate is at least 0.10 above the four weeks'; one item a week, the mode with the most decided battles. facts: the member, mode (ladder, ranked, war, event or casual), week {from, to, battles, decided_battles, wins, losses, win_rate} and previous {from, to, weeks, decided_battles, win_rate}, battles_performance's own numbers for those windows (boat defenses never count); follow is battles_performance with the two windows. A weekly run stores it six hours after the week ends (Monday 16:15 UTC), when an observed window learns it; battles recorded after Monday 16:00 UTC never change it.",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
