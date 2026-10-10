import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.0.2",
  date: "2026-10-03",
  summary:
    "clans_participation checks boat defenses by battle identity instead of scanning unrelated battle history. Current and former member counts, ranked battles, weekly donations, war counters and role history retain the same meaning. No response fields or JSON API operations change.",
} satisfies ChangelogEntry;
