import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.18.1",
  date: "2026-09-23",
  summary: md(
    "The boat note quoted its share against the wrong denominator (feedback #89).",
    list(
      "6.15.0's note names `points / scoring_decks` as the rate boat decks contaminate, then reported each member's share against `decks_used`. On a week that finished those differ: ryguy67 read \"1 of 8\" where the rate's own denominator makes it 1 of 4 - exactly double. The share is now of `scoring_decks`, and it reads \"up to N\", because `boat_attacks` is the WEEK's counter and the record cannot say which of them fell on a scoring day, so it is a ceiling on the contamination rather than a measurement of it.",
    ),
    "Note text only; no field changed.",
  ),
} satisfies ChangelogEntry;
