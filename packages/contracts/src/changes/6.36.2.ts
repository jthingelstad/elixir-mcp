import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.36.2",
  date: "2026-09-23",
  summary:
    "The 6.36.1 notes name other tools' fields in the tool.field form (`war_history.closed_at`, `war_history.progress_earned`, `war_rivals.mean_fame`), so a response never names a field it does not carry.",
} satisfies ChangelogEntry;
