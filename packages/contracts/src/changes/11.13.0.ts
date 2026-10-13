import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.13.0",
  date: "2026-10-13",
  summary: md(
    "An answer to feedback is a timeline item of its own, with its words, and the answer email is now written from that item.",
    list(
      "elixir_timeline: account_feedback_responded is one item per answer, never folded into a burst of account events, schema account_feedback_responded/3. Its story is the feedback item, so a revised answer is the same id at a higher revision. New facts: response, shipped_in, area, category, message (the first 600 characters), filed_at and answered_at, beside feedback_id and status; count is always 1 and apps always empty. follow is elixir_my_feedback with that feedback_id, which reads the item whole and marks the answer seen. An answer from before this version that a later one replaced has response and shipped_in null.",
    ),
    "Additive. JSON API 3.2.0 is unchanged.",
  ),
} satisfies ChangelogEntry;
