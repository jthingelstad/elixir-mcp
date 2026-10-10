import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.33.0",
  date: "2026-09-08",
  summary:
    "Players you add can finally be told apart. Relationship - primary, alt, friend, watching - shipped as a column months ago and your connected agent has been reading it the whole time, but nothing could ever set it, so every player you added was announced as 'watching'. You can set it now from Account > Overview, and your agent's opening context says what each player actually is to you. Agents also became operable: issue a replacement key without losing the agent's identity or its place in its event feed, suspend and resume one, read what it has been notified about, see who it answers for, and see how many of your daily calls it is spending. A suspended agent's key simply reads as invalid.",
} satisfies ChangelogEntry;
