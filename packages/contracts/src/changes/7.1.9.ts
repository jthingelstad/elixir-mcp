import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "7.1.9",
  date: "2026-09-24",
  summary: md(
    "The badge tools after the Elixir Gym's fifth run on them (feedback #279-#280), and a badge stamp the players gate caught.",
    list(
      "A population with no profile read (players_considered 0) says its badges are unknown, not absent: an opponent seen only in battles had read as holding no badges (#279).",
      "A holder's `observed_at` is the newest profile read, from the snapshot or the poll ledger: a poll that found nothing changed leaves the day row as it was, so the stamp had lagged `players_profile.meta.source_polls` by a poll.",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
