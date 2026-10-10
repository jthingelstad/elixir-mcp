import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.41.0",
  date: "2026-09-09",
  summary:
    "war_current reconciles the race roster against the clan roster: participants_count, member_count and members_not_in_race[] name the current members this week's race leaves out, each with reason not_in_race_roster. Verified against the live API rather than assumed - its own currentriverrace clan.participants returns the same shortfall, so participants was always faithful and the gap is upstream. The API gives no reason for the omission and neither does this, so nothing is invented; the finding is written up in the public Clash Royale API reference. Treat participants.length as the race roster, never as a member count.",
} satisfies ChangelogEntry;
