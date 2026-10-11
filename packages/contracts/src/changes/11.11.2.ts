import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.11.2",
  date: "2026-10-11",
  summary: md(
    "A correction to the new-best sentence.",
    list(
      'elixir_timeline best_trophies_band: when the best the record saw (facts.best) is higher than where the crossing battle ended (crossed_by.trophies_after), text tells the crossing, then the peak after it: "<name> passed 12,000 trophies for the first time, on a 3-0 win over <opponent> (11,943), +26 to 12,005, and went on to a best of 12,032." Before, it read "set a new best of 12,032 trophies, crossing 12,000, ... +26 to 12,005", as if the battle had set the best. When the crossing set the best itself, or no crossing battle is known, the sentence is as before.',
    ),
    "A correction: facts, fields and shapes are unchanged. JSON API 3.2.0 is unchanged.",
  ),
} satisfies ChangelogEntry;
