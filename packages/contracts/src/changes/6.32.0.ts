import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.32.0",
  date: "2026-09-23",
  summary: md(
    "The card tools, after the Elixir Gym's second run on them (feedback #153-#155).",
    list(
      "`cards_synergy` on a banded season read counts partners over the rollup's own population. The partner walk had kept event battles and drafted decks the anchor row leaves out, so `co_occurrence_rate` reached 4.92 and `lift` 139 (#153).",
      '`cards_card` and `cards_synergy` apply the meta population (no event content, chosen decks only) on a raw from/to window, as the season rollup does, so one window reads the same whichever way it is written. `mode: "event"` answers empty with a note saying why (#154).',
      "`cards_card` on ranked says `by_band` is empty because ranked has no trophy band, not that the rollup is unfilled. `methodology.prior_source` names what the read actually shrank toward (#155).",
    ),
    "Corrected values: raw-window card reads and banded synergy partners.",
  ),
} satisfies ChangelogEntry;
