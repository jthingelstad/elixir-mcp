import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.7.0",
  date: "2026-10-10",
  summary: md(
    "A timeline poll that finds nothing can now cost almost nothing. Most polls of elixir_timeline find no new item, and each one still read every subject's summary.",
    list(
      "elixir_timeline: new skip_empty argument (default false). With true, a window in which nothing could be an item this read keeps (its kinds; sections do not narrow the check) is answered without reading the subjects: timeline, entries and quiet are empty, entries_skipped is true, and a note says so. The window, next_cursor, read_to, a reader's pointer and meta move exactly as on any read. A window with an item reads exactly as without the argument. An evidence read always builds.",
      "elixir_timeline: every response carries entries_skipped, true only when skip_empty skipped the build. applied.skip_empty echoes the argument.",
    ),
    "Additive: the default read is unchanged. JSON API 3.1.0 is unchanged (elixir_timeline is not an /api/v1 operation).",
  ),
} satisfies ChangelogEntry;
