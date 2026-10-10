import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.22.3",
  date: "2026-09-06",
  summary:
    "elixir_events with a topics filter no longer acknowledges the events it hid. The seen-cursor is one number per account, so a topic-specific poll used to mark everything below the last returned event as seen - a war-only routine could silently clear an unread feedback reply, and normal resumed polling never showed it again. Acknowledgement now stops at the first event the filter excluded, and the response carries seen_through so you can tell when that happened. Separately, adding and removing the same player from two accounts at once can no longer leave a subscribed player unrecorded, or a recording running with no subscribers.",
} satisfies ChangelogEntry;
