import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.6.0",
  date: "2026-09-20",
  summary: md(
    "Deck archetypes, phase 2 (design §6, §7, §12.2): the archetype is stamped on every deck, so a whole population can be folded or filtered by name, and the fit reader says which shapes a player already fields.",
    list(
      '`battles_meta_decks { group_by: "archetype" | "family" }`: the population\'s decks folded by stamped label ("Royal Hogs bridge spam") or by family, one row each with `decks`, `battles`, `wins`, `losses`, `win_rate`, `players` and `share`; on a clan, player or collection segment each row carries `members[]` - who plays the shape, with battles, wins and their most-played deck of it - and `players` is exact. Sorted by players then battles: who plays what, never a tier list (`shrunk_win_rate` is deliberately absent). `decks[]` is empty with `group_by`. This is Elixir Clan\'s "what decks do our players use?" in one call.',
      "The `archetype` filter now runs over the stamp for every deck over `min_battles` (the 2,000-row bound of 6.5.0 is gone).",
      "`fit_for` on `battles_meta_decks`: `fit_for.plays` lists the families and labels the player fielded in the window, and every row's `fit` carries `plays_family` and `plays_archetype`, with a note ranking adoption cost - a row in a family they play costs the least, the same family with a different win condition is the usual next step, a new family is a new deck to learn as well as levels to buy.",
      "The stamp (migration 0148: `deck.archetype_family / archetype_label / archetype_win_conditions / archetype_version`) is written at deck insert and caught up nightly for every row behind the current grammar + vocabulary version; `{archetype_stamp}` on the migrate Lambda runs the same on demand. A vocabulary import or a rule change reaches history by the next morning.",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
