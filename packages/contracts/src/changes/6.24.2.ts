import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.24.2",
  date: "2026-09-23",
  summary: md(
    "clans_participation fits the result cap again at eight weeks, full.",
    list(
      "The finished-early caveat is one sentence naming every finished week. A note per week had pushed the eight-week full read past the 48,000-character cap from 6.23.0, and it was refused. `war_scoring_decks` rides windows of up to six war weeks, which the default five ISO weeks span.",
    ),
    "Wording and a window limit; no shape change.",
  ),
} satisfies ChangelogEntry;
