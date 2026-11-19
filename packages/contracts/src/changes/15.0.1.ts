import { md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "15.0.1",
  date: "2026-11-19",
  summary: md(
    "Reporting a post with a battle attached hides it from the reporter's mixed Timeline, battle-post reads and unread checks while the report is open.",
  ),
} satisfies ChangelogEntry;
