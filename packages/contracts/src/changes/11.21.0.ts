import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.21.0",
  date: "2026-11-12",
  summary: md(
    "A name search says enough to tell two players with one name apart (slice 6, #764: the website's search shows each row's tag, clan and trophies).",
    list(
      "`players_search`: each match carries `trophies`, the Trophy Road trophies on the player's latest recorded snapshot, or null when none is recorded.",
    ),
    "Additive: one field on each match. The JSON API is unchanged.",
  ),
} satisfies ChangelogEntry;
