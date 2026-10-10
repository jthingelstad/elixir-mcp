import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.33.0",
  date: "2026-09-23",
  summary: md(
    "The clan tools after the Elixir Gym's second run on them (feedback #157-#158), and a rule for weekly donations.",
    list(
      "`clans_standings` `mode` is event-aware on every part of the answer: the edge days' raw rows and the streak rows now use the rollup's own group rule. `casual` had counted 281 event battles, and `event` had missed 285 (#157).",
      "Weekly donations are the highest counter value the record saw in the week's game days (Monday 10:00 to Monday 10:00 UTC). The weekly counters only climb until they drop to 0 at the weekly reset, so the highest value is the week's total, however close to the reset the reads fall. The `pre_reset` row keeps its high-water mark, so a read after the reset can no longer zero it. The weeks ending 2026-09-07 and 09-14 are repaired to the best value recorded. `clans_participation` and the clan summary on `elixir_timeline` read the week's highest value (#158).",
    ),
    "Corrected values: standings by mode, and weekly donation totals.",
  ),
} satisfies ChangelogEntry;
