import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "5.0.0",
  date: "2026-09-19",
  summary: md(
    "Pilot Score is gone (Jamie, 2026-09-19: a mirage). Three reviews on the year of the record (docs/reviews/2026-09-19-PILOT-SCORE-ASSESSMENT.md, -PILOT-SCORE-EVOLUTION.md, -ELIXIR-LIFT-TWO-POPULATIONS.md) found that 70-76% of the observations it scored carried no level adjustment at all (Ranked and casual equalize card levels), that between players the adjustment was nearly orthogonal to outcomes (r = 0.09), that a raw win rate was as reliable as the score, and that in Ranked the score was the win rate and the win rate a weekly coin toss. Elixir records and makes the record available; it does not score players against an expected win rate, and will not carry a branded metric of any kind. The card-level fact stays where it always was: `mean_level_gap`, `level_gap_battles` and `comparable` on the deck, card, summary and standings readers.",
    "The same release fills out the card noun (docs/reviews/2026-09-19-CARDS-REVIEW.md): `cards_catalog` carries `type` (troop, building, spell, tower_troop, from the id range the API does not spell out) and `fetched_at` beside `as_of` (which is the catalog's last CHANGE, and now says so); `battles_meta_cards` takes `cards: [ids]` and `battles_meta_decks` takes `containing: [ids]` (decks with ALL the cards, any form), both applied after aggregation so `usage_share` and `decided_battles` stay the population's.",
    "No deprecation window: every client of this server is first-party (the 3.0.0 and 4.0.0 precedent). The first call after reconnecting should re-fetch `tools/list`.",
  ),
  tools_added: ["cards_card"],
  breaking: list(
    'Every card object carries `form: "base" | "evolution" | "hero"` and the integer `evolution` key is gone: deck cards on `battles_query`, `battles_decks`, `battles_meta_decks` and `players_summary` (which once dropped the form), rows of `battles_cards` and `battles_meta_cards`, and `cards_synergy` partners (which carried both spellings). `forms_available` / `forms_unlocked` on the catalog and collections are unchanged (they are sets). `elixir_timeline` facts are unchanged.',
    "`battles_levels` removed: the Level Curve and the per-player Pilot Score, monthly trend, experience cohort and population changes. No replacement; `mean_level_gap` on `players_summary`, `battles_decks`, `battles_cards`, `battles_meta_decks`, `battles_meta_cards` and `clans_standings` is the record's statement about card levels.",
    "`clans_pilot_scores` removed. No replacement.",
    "The meta readers' comparability note no longer points at `battles_levels` for a level-expected rate; it says the record describes the gap and does not adjust for it.",
  ),
} satisfies ChangelogEntry;
