import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "13.0.2",
  date: "2026-11-13",
  summary: md(
    "A correction: a duel is known by its round decks, not only by its type. A battle played as games on round decks that is not a `riverRaceDuel*` (an event's multi-deck mode, the 1v1 Duel friendly) carried `deck.rounds[]` but no `rounds[]`, so its games had no results.",
    list(
      "`battles_query`: every row whose decks sit under `deck.rounds[]` carries `rounds[]` (each game's crowns, tower_hp and elixir) on both sides, `elixir.leaked` sums the games with `elixir.rounds` the count and `elixir.differential` null, and `me.vs` is null, as on a river race duel. The duel note names these rows too.",
    ),
    "No field or argument was added or removed. The JSON API is unchanged at 5.0.0.",
  ),
} satisfies ChangelogEntry;
