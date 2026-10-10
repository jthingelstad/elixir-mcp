import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.20.1",
  date: "2026-09-05",
  summary:
    "Grounding affordances (agent feedback #8 - an inference-error case study, filed at the user's request): war_current now carries an explicit period block (period_index, war_day, started_observed_at, period_end_nominal, week_end_nominal) so temporal claims cite fields instead of inferring; event-type lists are framed as schema-not-news; elixir_feedback accepts category 'other' and unknown categories get the valid list back.",
} satisfies ChangelogEntry;
