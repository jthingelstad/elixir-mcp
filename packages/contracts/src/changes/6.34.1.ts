import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.34.1",
  date: "2026-09-23",
  summary:
    "elixir_timeline holds 150 items a page, down from 200, so a compact page fits the 48,000-character result cap now that every session_standout is an item (a 7-day compact read had reached 54,766). The rest page through `next_cursor`. elixir_updates and the elixir_docs index point at the about page.",
} satisfies ChangelogEntry;
