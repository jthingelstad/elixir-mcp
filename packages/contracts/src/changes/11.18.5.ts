import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.18.5",
  date: "2026-11-09",
  summary: md(
    "`players_summary` leaves boat defenses out of its counts, as every other surface does (Jamie, 2026-09-24 and 2026-09-25; acceptance Gym #262.1).",
    list(
      "A boat defense is an enemy attacking the clan's boat, answered by the member's defense deck: not a battle the member played. `players_summary` had still counted them in `last_30_days.battles`, `wins`, `losses` and `modes`, and in `top_deck` and `best_deck`, so its 30 days disagreed with `battles_performance` over the same window whenever the boat was attacked. `last_30_days.boat_defenses` still says how many there were, and the note now says they were left out.",
    ),
    "Changes a number: a member whose boat was attacked in the 30 days sees fewer battles and war battles. No field changes; the JSON API is unchanged.",
  ),
} satisfies ChangelogEntry;
