import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.19.2",
  date: "2026-09-23",
  summary: md(
    "One note, said in the reader's words.",
    list(
      '`war_history`\'s `finished_early` note said a week "without a standings capture" is null. Capture is our word for how the record is taken, not the reader\'s; it now says a week "whose standings were never recorded". The flag\'s `outputSchema` description gains the in-progress case 6.19.1 added to the note.',
    ),
    "Wording only.",
  ),
} satisfies ChangelogEntry;
