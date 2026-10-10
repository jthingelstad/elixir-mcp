import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.6.0",
  date: "2026-10-08",
  summary: md(
    'The cards and players you lost to most can be read first, as a choice: battles_cards and battles_opponents take sort: "losses", and every opponent row carries its level gap. The default order is unchanged.',
    list(
      'battles_cards: new sort argument, "battles" (the default, most battles first, as before) or "losses" (most battles lost first, ties to the most battles). applied.sort echoes it. A row still needs three battles (applied.min_battles), so a single loss never leads; the rows and their counts are the same in either order.',
      "battles_opponents: sort also takes \"losses\" (most battles lost first, then most battles, then most recent). Each opponent row gains mean_level_gap: your deck's average card level minus the opposing side's over the battles with both recorded, on the display scale; null when none were, as in a duel.",
      "Wording: battles_cards' declaration, its OPPONENT note and the pooled-modes note no longer call a card a nemesis or a strength.",
    ),
    "Additive. JSON API 3.1.0 is unchanged: neither tool is an /api/v1 operation.",
  ),
} satisfies ChangelogEntry;
