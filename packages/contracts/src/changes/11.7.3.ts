import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.7.3",
  date: "2026-10-10",
  summary: md(
    "battles_query's next_cursor is null on the last page even when that page is exactly full, as its schema promised; a full final page used to carry a cursor that opened an empty page.",
    list(
      "battles_query: next_cursor is set only when another battle matches beyond the page.",
    ),
    "A correction: fields and shapes are unchanged. JSON API 3.1.0 is unchanged.",
  ),
} satisfies ChangelogEntry;
