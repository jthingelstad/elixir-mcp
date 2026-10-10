import { md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.10.1",
  date: "2026-09-26",
  summary: md(
    'An `award_standing` item that names who held first place before carries `previous_name` beside `previous_player_tag`, and its sentence says "taking it from <name>" instead of a bare tag: a lead changing hands, which a clan\'s agent announces, is said with both names.',
  ),
} satisfies ChangelogEntry;
