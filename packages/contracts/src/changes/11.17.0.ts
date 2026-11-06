import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.17.0",
  date: "2026-11-06",
  summary: md(
    "The time a timeline item shows is the time it sorts by; evidence names the other side; a first friend stays a friend.",
    list(
      "elixir_timeline, clans_timeline and clans_members_timeline: `at_unix` and `local` now name `sort_at`, so a sitting reads at its last battle, in the order served. `at` is unchanged: a sitting's first battle.",
      "elixir_timeline evidence: each battle gains `opponents`, each `{ player_tag, name, crowns, clan_tag, clan_name }` by in-game name, empty when the record holds none.",
      "elixir_track_player: a first player named `friend` or `watching` stays that and does not become your primary. `applied.relationship` says what was applied, and a note says the account has no player of its own until you name one with `primary`. A first player with no relationship still becomes your primary.",
    ),
    "JSON API unchanged.",
  ),
} satisfies ChangelogEntry;
