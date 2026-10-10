import { md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.19.2",
  date: "2026-10-02",
  summary: md(
    "Season card partners narrow deck identities to decks containing the requested card and bound uncached observations by the recording cursor before expanding duel rounds. Card profiles filter their season deck rows in the database. Corpus weekly trends bound participant rows by time before applying recorded-player membership. Counts, forms, mode classification, exclusions and response schemas are unchanged. Correction; no JSON API change.",
  ),
} satisfies ChangelogEntry;
