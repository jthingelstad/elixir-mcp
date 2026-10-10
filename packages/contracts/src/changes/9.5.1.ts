import { md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.5.1",
  date: "2026-09-25",
  summary: md(
    "`battles_deck_sets`: the one wider pass, when the default gates pack nothing, also drops the level floor. A maxed account read back at 9.5.0 still got no set: its main decks are level 16 and most of its other cards are not, so 1,585 of 1,864 season decks held a card under the floor of 12. On the wider pass the gap is priced by `level_term` alone and shown as each deck's `fit.lowest_card`; `fit_for.min_card_level` is null when no floor answered.",
  ),
} satisfies ChangelogEntry;
