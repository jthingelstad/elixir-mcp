import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "7.0.0",
  date: "2026-09-23",
  summary: md(
    'The timeline is a newsfeed (Jamie, 2026-09-23: "we had the whole concept of Timeline backwards; think of it like the newsfeed in a social app"). What happened most recently comes first, everywhere the timeline is read: `elixir_timeline`, the console, and the mail built from it.',
    list(
      "`elixir_timeline` serves `timeline` newest first by `at`.",
      "A window past the 150-item cap, or past the response's size budget, keeps its NEWEST items: those the record observed after the newest item left out. The older ones are counted in `timeline_more`, not served, and `has_more` is true; a note names the instant, so a reader that wants them passes the same `from` with `to` there and `mark_read: false`. The entries still summarize the whole window.",
      "`next_cursor` is always the window's end, and `mark_read` always moves the pointer there: a reader catching up after days away lands on the present.",
      "A clan's member moments keep their newest 100 when a window holds more, and the clan entry's `roster.joined`, `roster.left` and `roster.role_changes` lists are newest first, keeping their latest twenty.",
    ),
    "No deprecation window: every client of this server is first-party (the 3.0.0, 4.0.0 and 5.0.0 precedent). A consumer that needs time order sorts by `at` itself, as the Discord preview already does.",
  ),
  breaking: list(
    "`elixir_timeline` `timeline` order is newest first; it was oldest first.",
    "`next_cursor` no longer pages forward from a cut: it is always `window.to`. Past the cap the older items are counted in `timeline_more` rather than reached by a cursor, and `mark_read` moves the pointer to the window's end, not to the cut.",
    "Clan entry roster lists (`joined`, `left`, `role_changes`) are newest first.",
  ),
} satisfies ChangelogEntry;
