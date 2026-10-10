import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.36.1",
  date: "2026-09-08",
  summary:
    "Clarify numerical precision in statistical tool notes: calculations use unrounded aggregates; rates and scores are independently rounded to three decimals. Recomputing a shrunk rate or score from displayed rates can differ in the final decimal place. Calculations themselves are unchanged.",
} satisfies ChangelogEntry;
