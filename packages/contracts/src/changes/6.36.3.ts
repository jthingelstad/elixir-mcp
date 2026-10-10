import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.36.3",
  date: "2026-09-23",
  summary: md(
    "The badge tools, after the Elixir Gym's third run on them (feedback #183-#184).",
    list(
      "A clan segment counts the clan's current members who are recorded now, the corpus rule of 6.30.1, so a stale read under an old clan tag is left out. A note says how many of the clan's members that is, and that the rest are unknown, not non-holders: a clan recorded at roster level had read as \"every member holds it\" over 17 of 50 (#183).",
      "`min_level` on a one-off badge is refused with the reason; it had answered 0 holders. A badge's `kind` comes from the whole record, so an empty answer says tiered or one-off, not null (#184).",
    ),
    "Corrected values: the clan segment's population; a refusal where a wrong zero was.",
  ),
} satisfies ChangelogEntry;
