import { md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.12.3",
  date: "2026-09-27",
  summary: md(
    "Every live read is charged to the collector fleet's one global request budget when it is queued (review §4.1). When that budget is spent until the next scheduler tick, `live: true` and `live_fetch` queue nothing and charge nothing, your daily live quota included: `live_status` stays `pending` with `retry_after_s` the seconds to that tick, and the note (or the `live_pending` message) says the budget had no room. A read already queued for the same subject is shared and never charged twice.",
  ),
} satisfies ChangelogEntry;
