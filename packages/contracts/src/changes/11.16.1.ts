import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.16.1",
  date: "2026-11-05",
  summary: md(
    "A departure's role is the one held when the member departed.",
    list(
      "elixir_timeline, clans_timeline, clans_members_timeline: `departure_classified`'s `facts.role_at_departure` reads the closed stint the departure ended, not a later one after the member came back. With no such stint the fact is absent.",
    ),
    "Correction. JSON API unchanged.",
  ),
} satisfies ChangelogEntry;
