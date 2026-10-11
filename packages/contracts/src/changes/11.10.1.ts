import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.10.1",
  date: "2026-10-11",
  summary: md(
    "Corrections to 11.10.0's feedback changes.",
    list(
      "JSON API GET /feedback: feedback_id and verbosity now reach elixir_my_feedback, as 3.2.0 documents. In 11.10.0 they were dropped: feedback_id returned the list, and compact returned bodies and marked them seen.",
      "elixir_my_feedback: applied.verbosity says full on a full page, as every other tool's does.",
      "A needs_info answer must carry a new question; with none, or the item's current response, it is refused (needs_question) instead of silently relabelling the old answer.",
    ),
    "A correction: fields and shapes are unchanged. JSON API 3.2.0 is unchanged.",
  ),
} satisfies ChangelogEntry;
