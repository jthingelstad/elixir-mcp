import { md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.19.1",
  date: "2026-10-02",
  summary: md(
    "Historical clan presence is bounded by membership in the requested window. A later departure or a future join no longer changes the closed window's quiet crossings, returns or never-recorded count. Quiet and never-recorded summary values read membership at the window's end; crossing and return items read membership at the moment they describe.",
    "Corpus card meta scans deck identities once; weekly trends reuse one battle population; season card partners read the population cache plus every battle learned after its cursor, including late arrivals. Counts, forms, exclusions and result shapes are unchanged. Correction; no JSON API change.",
  ),
} satisfies ChangelogEntry;
