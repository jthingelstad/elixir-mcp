import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "3.8.0",
  date: "2026-09-15",
  summary:
    "elixir_my_feedback returns lossless bounded pages: pass next_offset as offset until null; total counts the filtered ledger. A page may contain fewer rows than limit when full feedback and maintainer text would exceed the delivery cap. Only responses actually delivered on that page are marked seen, so an oversized or limited read can no longer clear feedback_responses_pending for replies the caller did not receive. Additive.",
} satisfies ChangelogEntry;
