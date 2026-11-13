import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "12.1.2",
  date: "2026-11-13",
  summary: md(
    "A doc section is read at its current page only: the forwards for sections that moved when a long page split are gone.",
    list(
      "`elixir_docs`: a `page` and `section` pair that moved (`battles` + `war-weeks-points-and-fame`, `recording` + `daily-series`) is `not_found`, with the page's sections in the hint; ask the current page (`decks-and-war`, `freshness-and-gaps`). The note that said a section moved is gone with it.",
      "`elixir://docs/<page>#<section>` reads the same way.",
      "`players_series`' description names `freshness-and-gaps#daily-series`. Every `docs` pointer a tool emits already named the current page.",
    ),
    "No field or argument changed. The JSON API is unchanged.",
  ),
} satisfies ChangelogEntry;
