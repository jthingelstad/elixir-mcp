import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.36.0",
  date: "2026-09-08",
  summary:
    "Statistical alignment: deck/card meta exclude draws and unresolved outcomes from decided totals, usage and shrinkage baselines; empty segments return segment_win_rate: null. Both return methodology and window_to. Card meta rejects reversed windows and excludes empty card arrays. Even-sized cohort medians average the two middle scores. Personal and clan Pilot Scores share ingest-stamped level averages and a population of exactly two opposing decided participants with known levels. battles_levels declares its existing include_curve option. Both expose methodology explaining sample floors and the legacy standard_error approximation, which is not a calibrated score confidence interval. Aggregate basis counts do not identify the fitted curve or prove why a score changed. Public methodology and earlier release claims now reflect these limits.",
} satisfies ChangelogEntry;
