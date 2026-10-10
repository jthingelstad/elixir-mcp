import { md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.19.3",
  date: "2026-10-02",
  summary: md(
    "Corpus trends select covered player/time keys before fetching battle identifiers and trophies, retaining distinct games at the same timestamp. Season card partners read anchor-bearing cached participants and duel parents once, then expand rounds; recent and overlapping observations use bounded key lookups. Counts, forms, mode and membership rules, exclusions and response schemas are unchanged. Correction; no JSON API change.",
  ),
} satisfies ChangelogEntry;
