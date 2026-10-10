import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.16.0",
  date: "2026-09-22",
  summary: md(
    "A duel can answer for its own rounds, and a battle says whether you met a ranked opponent.",
    list(
      "`battles_query` rows carry `rounds[]` on a duel: each GAME's own crowns, `tower_hp` and `elixir` - including a per-round `differential`, which the summed top-level counter cannot have - on the round numbers `deck.rounds[]` already used, so a round's deck and its result line up. The API has always reported these; Elixir recorded the round DECKS and discarded the round RESULTS, and said so in the docs as if it were a property of duels. 20,218 round rows across 4,362 duels were filled back from the payload archive.",
      "`global_rank` on every participant of every row: the player's global leaderboard position as the API reported it ON that battle, null unless they were ranked then. 129,162 rows carry one, range 1-500.",
    ),
    "Additive. Both ride full verbosity only; compact is unchanged.",
  ),
} satisfies ChangelogEntry;
