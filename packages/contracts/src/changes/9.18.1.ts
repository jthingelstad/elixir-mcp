import { md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.18.1",
  date: "2026-10-02",
  summary: md(
    "A battle's `url` with `.png` on the end is its picture: the battle page drawn as one 1200 by 630 image, with both names, both decks, the elixir numbers, the towers and the link. The page's link unfurls with it. `url`'s description says so; no field changed.",
  ),
} satisfies ChangelogEntry;
