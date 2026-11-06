import { md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.18.4",
  date: "2026-11-06",
  summary: md(
    "Names no longer carry the game's colour markup such as `<c5>`. It is stripped when a payload is recorded and from names already stored, so `players_search` and every name in a response read as the plain name. No shapes change.",
  ),
} satisfies ChangelogEntry;
