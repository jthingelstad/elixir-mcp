import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.5.1",
  date: "2026-10-08",
  summary: md(
    "live_fetch only fetches: the payload comes back to the caller and never enters the record. Before, its read was admitted like a scheduled poll, so a raw read of a player nobody tracks left their profile, collection and badges in the record.",
    list(
      "live_fetch: the result waits for the follow-up call outside the record (no snapshot, battles, roster rows, receipt or archive) and is gone within the hour. Any read inside the API's cache window still answers it, a recorded one included. Its note says it stores nothing.",
      "live: true on players_profile, clans_roster, war_current and battles_query is unchanged: the tool answers from the record, so its read is recorded. A live_fetch result is never taken as that fresh read.",
    ),
    "Patch: no arguments or output fields change. JSON API 3.1.0 is unchanged; GET /api/v1/clans/{tag} (the clan read live_fetch serves) stores nothing either.",
  ),
} satisfies ChangelogEntry;
