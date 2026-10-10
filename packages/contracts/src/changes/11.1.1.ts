import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.1.1",
  date: "2026-10-04",
  summary:
    "Successful admitted profile reads advance the daily profile observation time even when the projected values are unchanged. Timestamp-only updates earn no new facts or collector points, preserve newer roster values and cannot regress on older deliveries. No response fields change. Profile counters and finite battle-log history do not establish absence of battle activity across every mode; Clan removal freshness and admission rules are unchanged. JSON API remains 3.0.0; response shapes are unchanged.",
} satisfies ChangelogEntry;
