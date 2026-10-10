import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.36.8",
  date: "2026-09-23",
  summary: md(
    "`badges_rarity` with `limit`, after the Elixir Gym's fourth run on the badge tools (feedback #193-#194).",
    list(
      'The versioned-pair note reads every badge in the population, not just the page, so a legacy identifier listed alone (Royal Tournament Rank, 1 holder on the rarest-10 page) still says how many distinct players hold the badge by either identifier (603). A page cut by `limit` says how many of the population\'s badges it lists, and the "a badge nobody here holds does not appear" note is served only on a complete list (#193).',
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
