import { md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "8.0.1",
  date: "2026-09-24",
  summary: md(
    "`players_profile` `snapshot.progress[].current` compares each bucket with the newest profile read, not the newest bucket: a player whose only side-mode bucket had ended (a Merge Tactics season last read 08-31 beside a 09-24 profile) read it as current (#329).",
  ),
} satisfies ChangelogEntry;
