import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.23.0",
  date: "2026-09-06",
  summary:
    "Collections now cause recording. A player or clan named in a collection is collected for as long as it stays there - curating a list used to record nothing, so you had to add each subject to an account as well. Each collection carries how deeply to record what it names: 'comprehensive' captures battles (every member's for a clan, the player's own for a player), 'activity' captures only the surface (a clan's roster/war/standings, a player's profile). collections_browse and collections_get report that as scope. Depth is only ever deepened on a shared subject, never taken away, and removing something from a collection stops recording it unless a claim or another collection still wants it.",
} satisfies ChangelogEntry;
