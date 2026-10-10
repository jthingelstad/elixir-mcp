import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.36.12",
  date: "2026-09-23",
  summary: md(
    "The ranking tools, after the Elixir Gym's third run on them (feedback #208-#210).",
    list(
      "`standings_changed_at` moves only when the standings moved: a player on both reads changed rating, or a newcomer entered at or above the previous board's floor. A player leaving shifts every rank below them and pulls the next player in at the bottom, and that had stamped closed mode boards as moving today. Ingest applies the rule and migration 0162 recomputes the mode boards' stamps, so the stale note and the catalog's running-or-closed signal read true (#208).",
      '`rankings_timeline` echoes `applied.window.source` "argument" when `from`/`to` narrow a `season`, and its description says a point is written whenever the board\'s content changed (#209).',
      "Every windowed tool answers a season that has not begun with an empty window at its start and a note saying when it starts, where it had served a window ending before it began (#209).",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
