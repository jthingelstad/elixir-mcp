import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "13.1.1",
  date: "2026-11-13",
  summary: md(
    "A correction: `clans_roster` lists members in one order every time. Members of the same role on equal trophies (a capped Trophy Road puts many there) had no order between them, so two identical reads could list them differently.",
    list(
      "`clans_roster`: within a role, members are listed by trophies, then by the game's clan rank, then by player tag.",
    ),
    "No field or argument changed. The JSON API is unchanged at 5.0.0.",
  ),
} satisfies ChangelogEntry;
