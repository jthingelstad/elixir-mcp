import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "7.1.10",
  date: "2026-09-24",
  summary: md(
    "The card tools after the Elixir Gym's fifth run on them (feedback #281-#285).",
    list(
      "`cards_card` `card.first_played` keeps each form's earliest deck: on the four cards with both an Evolution and a Hero, a later row had overwritten base's date (#281).",
      'A tower troop passed to the card tools is refused as what it is, with where tower troops are read, instead of "not in the catalog" beside `cards_catalog` listing it (#282).',
      "`cards_card` `members.held[].observed_at` is the newest read of the member's collection; `since` keeps when that level was first seen, which is what it had served (#283).",
      "The shrinkage note says `shrunk_win_rate` is withheld when the POPULATION holds fewer than 30 decided observations; a row with few battles still carries one (#284).",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
