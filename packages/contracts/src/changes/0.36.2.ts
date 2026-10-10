import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.36.2",
  date: "2026-09-08",
  summary:
    "Response metadata is checked against the shared contract at construction and at the tool registry boundary. The existing timezone_applied field is now declared; timestamps, optional history, source freshness, counters and receipt IDs are checked. Public response examples are generated from the same contract. Valid response shapes and tool calculations are unchanged.",
} satisfies ChangelogEntry;
