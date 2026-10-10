import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "3.3.0",
  date: "2026-09-15",
  summary:
    "game_events now carries first_sighting_day and its horizon note reads the table rather than a date in the code: the elixir-bot backfill placed sightings from 2026-06-13 before the daily reads that began 2026-09-11. Same backfill, no shape change elsewhere: POAP KINGS battles from January, snapshots from March 7, war weeks from season 129 with per-day attendance from March, and first_observed_in_clan from the clan's earliest recorded roster read (2026-03-12) instead of this record's start.",
} satisfies ChangelogEntry;
