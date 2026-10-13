import { md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.12.1",
  date: "2026-10-13",
  summary: md(
    "battles_query carries its duel note (how riverRaceDuel rows collapse their games, rounds_played and rounds[]) only when the page holds a duel. Before, every page carried it and named fields no row on the page had. No field changes. JSON API 3.2.0 is unchanged.",
  ),
} satisfies ChangelogEntry;
