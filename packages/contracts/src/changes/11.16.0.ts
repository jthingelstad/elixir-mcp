import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.16.0",
  date: "2026-11-05",
  summary: md(
    "Timeline lines read as a person says them, in one wording for every door, and an occurred clan entry's `activity` counts every battle played in the window.",
    list(
      'elixir_timeline, players_timeline, clans_timeline, clans_members_timeline: `text` changes. A sitting is "played 10 battles in one sitting", a race "finished Season 137, week 4 (Colosseum) in 2nd place", a clan summary says `departed:` for `left:` and `sittings` for `sessions`, modes read Path of Legends and Casual. Read `facts`, never parse `text`. Stored keys and kinds are unchanged.',
      "A clan entry's `roster.left[]` no longer serves `tenure_days`: how long someone stayed is not part of a departure's record of the week.",
      '`departure_classified`: new optional `facts.role_at_departure`, read from the membership; the sentence ends "(was Member)" when it is known.',
      "A clan entry's `activity` on an occurred read counts battles played in `[from, to)` by `battle_time`, including ones learned late. Boat defenses are out on both bases.",
    ),
    "JSON API unchanged. `clans_participation` is unchanged and its week columns stay ISO weeks.",
  ),
} satisfies ChangelogEntry;
