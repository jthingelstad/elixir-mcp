import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.35.0",
  date: "2026-09-08",
  summary:
    "Performance summaries now aggregate the entire requested window; last_n_battles remains an explicit sample. Player response metadata distinguishes the oldest relevant poll, individual source_polls, earliest stored recorded_since, and recording_active_since. war_current exposes its current-race source observation age and warns when the observed period has passed its nominal end. Coverage compares matching profile-observation intervals with recorded battles at read time, so multi-day polling and late arrivals no longer create false daily estimates. observation_intervals and incomplete_intervals replace unsupported daily precision; incomplete_days is retained as null. Oversized MCP results return valid JSON errors with the original request_id rather than sliced success bodies. Methodology now describes the shipped pooled/shrunk statistics and the limitations of Pilot Score.",
} satisfies ChangelogEntry;
