import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.21.1",
  date: "2026-09-06",
  summary:
    "Clan notifications actually notify: member_joined, member_left, and member_role_changed now flow to the event feed for clans you've added (the only clan topic before was the WEEKLY war boundary - working as designed, but the design covered almost nothing). Also: every fresh battlelog poll is now capture-audited (was the payload's oldest battle already known?) and the 24h gap count is public on Data > Status.",
} satisfies ChangelogEntry;
