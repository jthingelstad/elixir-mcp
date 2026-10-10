import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.33.1",
  date: "2026-09-23",
  summary:
    "`collections_get` says what `years_played` is: the account's age in whole years (the game's YearsPlayed badge level), not time in the collection, and null until a profile poll has read the badge. Its description no longer calls it tenure, or calls `open_members` an open-member count (feedback #160).",
} satisfies ChangelogEntry;
