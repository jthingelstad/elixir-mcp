import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.18.0",
  date: "2026-11-06",
  summary: md(
    "The manual is reorganised into three groups, and every old address still answers.",
    list(
      "`elixir_docs`: an index page's `group` is now Use Elixir, Connect an AI or Build and reference. Eighteen new slugs hold what longer pages split into, among them `connect-a-client`, `connecting`, `freshness-and-gaps`, `decks-and-war`, `timeline-tool`, `inactivity-clock` and `ladder-season`.",
      "`elixir_docs` with a `section` that moved answers from its new page, under that page's `slug`. So does `elixir://docs/<page>#<section>`.",
      "Tool `docs_ref` pointers name the new homes.",
    ),
    "Additive: no argument, field or error changed, and nothing changes for the JSON API.",
  ),
} satisfies ChangelogEntry;
