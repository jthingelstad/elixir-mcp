import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "3.0.0",
  date: "2026-09-13",
  summary:
    "elixir_events is now elixir_timeline. The response carries the TIMELINE: items in order, each with an instant, a subject, a kind, a section, a sentence and its facts. Battles appear as sessions (a gap of 30 minutes breaks a session), never one by one; badges, arena and ranked moves, new bests and card unlocks are named from the ledger; joins, departures, role changes, the boat crossing the line and a week resolving are the clan's moments; quiet rungs crossed and returns are derived; your own account events ride beside them. The per-subject entries are unchanged in shape and gain sessions counts. mark_read replaces mark_seen and moves the read pointer to the window end; read_to reports the pointer after the call. meta.timeline_pending replaces meta.events_pending.",
  tools_added: ["elixir_timeline"],
  breaking:
    "elixir_events is removed; mark_seen is now mark_read; meta.events_pending is now meta.timeline_pending. The per-account event feed table and its cursor are gone from the record.",
} satisfies ChangelogEntry;
