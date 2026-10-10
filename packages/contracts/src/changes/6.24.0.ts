import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.24.0",
  date: "2026-09-23",
  summary: md(
    "The collection tools, after the Elixir Gym's first run on them (feedback #114-#116).",
    list(
      "Collections carry `synced_from`: the live board a collection's membership is re-synced from daily, or null for a curated one. A board collection says it follows the board and is not a fixed cohort, and its description says so. A collection segment on the meta tools and `cards_card` says it applies the membership as of the call (#116).",
      "`collections_get` says how its rows are ordered and what they are not: Trophy Road trophies, not a Path of Legends rating or the board's rank, with `rankings_players` / `rankings_clans` for the board's order. It also defines `open_members`, which is the clan's member count, not open places (#114, #115).",
      "`collections_browse`, `collections_get` and `collections_edit` publish their `outputSchema` (#115).",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
