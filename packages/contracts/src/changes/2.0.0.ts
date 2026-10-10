import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "2.0.0",
  date: "2026-09-13",
  summary:
    "elixir_events is an activity feed of ENTRIES, synthesized at read time: one per subject since your bookmark, each with a summary sentence a person can read, always-present sections (a player's battles, trophies, arena, ranked, collection, badges, clan, war, presence; a clan's activity, roster, war, presence, standouts, donations) and named notables. A person's subjects are the players they track and the clans they added; an agent's is its clan, with members inside the clan entry. Tracked players with nothing in the window are listed under quiet. from/to are instants (or local dates), next_cursor is the window end, mark_seen moves an instant bookmark, sections and verbosity trim the wire. meta.events_pending now counts subjects of yours with admissions since your bookmark. Facts with their windows, never advice, and nothing in the feed announces the time: schedule from game_clock.",
  tools_added: [],
  breaking:
    "The topic rows are gone: no events[], no topics argument, no integer event_id cursor, no coalesced {count} payloads, no war_day_open or clan_pulse rows. Read entries[] and quiet[] instead; a second consumer keeps its own from and passes mark_seen false, as before.",
} satisfies ChangelogEntry;
