import { md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.4.0",
  date: "2026-09-25",
  summary: md(
    "`battles_deck_sets`: the best sets of decks a player can field together sharing no card, the question Clan Wars asks (four decks, 32 distinct cards; a card's Evolution or Hero form is the same card). Chosen exactly (branch and bound) from decks this season's recorded players played in Trophy Road, Path of Legends and Clan Wars, reduced to the player's collection, unlocked forms and levels (no card more than two under the level they field), each deck valued from its record (shrunk per mode, Trophy Road and Clan Wars corrected for the players' level edge at 0.5 log-odds per level) and its fit, the weakest deck counted twice. `lock_decks` keeps decks and fills the rest ('a different last war deck'); `exclude_cards`, `require_cards`, `alternatives` (sets sharing at most two decks with each other) and `near_misses` (the decks it gave up, with the cards they lost) let an agent build a set with the player. Additive.",
  ),
  tools_added: ["battles_deck_sets"],
} satisfies ChangelogEntry;
