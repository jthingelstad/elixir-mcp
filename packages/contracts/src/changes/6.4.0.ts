import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.4.0",
  date: "2026-09-20",
  summary: md(
    "The population's decks against what one player holds (feedback #70, 2026-09-20). A corpus deck sorted by win rate reads as advice, and the payload carried nothing about the caller's collection: an agent recommended a deck the player could not field - two of the top four rows ran a card he did not own, the top row cost him two mean levels at his own card levels. Jamie's call: recommendations come from the player's collection, and the agent must be free to say what a few upgrades would open.",
    list(
      "`battles_meta_decks` takes `fit_for` (a player tag with a recorded collection). Every returned row's cards carry `held_level`; every row carries `fit`: `fieldable`, `missing` (each unowned card or locked form with its reason), `own_mean_level` (the deck at the player's levels), `vs_fielded` (against `fit_for.fielded_mean_level`, the mean level of the decks the player actually played in the window and mode), `upgrades` (each held card below the fielded level, largest deficit first, with the levels needed) and `mean_level_after_upgrades`. A row the player cannot field leaves `decks[]` for `unfieldable[]`, after sort and limit, so the population's ranking is unchanged and an agent cannot recommend what is not in the array. A `fit_for` block says whose collection, as of when, and the benchmark. An unrecorded collection is refused (`not_recorded`) rather than read as owning nothing.",
      "`battles_meta_cards` takes `fit_for` too: each row carries `held` (level, forms_unlocked, has_form) or null when the card is not owned.",
      "Without `fit_for`, both tools open their notes with the sentence that the rows are the population's and check nothing about any one player, and that a recommendation to a person should pass `fit_for`. With it, the note says what `mean_level_gap` is on a meta row - the population's edge, never the caller's - since the same name means the caller's on `battles_decks`.",
      "`players_collection` carries `fielded` - `{ days: 30, mean_level, battles }`, the mean card level of the decks the player actually played in the last thirty days - so 128 held levels have a benchmark without a second call.",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
