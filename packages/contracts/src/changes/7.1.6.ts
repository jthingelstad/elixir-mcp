import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "7.1.6",
  date: "2026-09-24",
  summary: md(
    "From the Elixir Gym's first-engagement journey: a new agent's first ten questions (feedback #256-#262).",
    list(
      "`battles_meta_decks` takes `min_players`, and says when most of the first rows are one player's own deck; the shrinkage note says `win_rate` is the raw rate at any size and only `shrunk_win_rate` is withheld under 30 observations (#256).",
      "`badges_rarity` over a one-player segment says every badge listed is that player's, so the order is not rarity, and points at a population (#257).",
      "`elixir_timeline` `player_tag` includes that member's battle sessions from a clan's timeline, echoes the filter in `applied`, and says when the tag is not one of the reader's players or clan members (#258). A clan entry's activity also counts `learned_here_played_before`, and the learned-versus-played note covers both directions (#259).",
      'The tool guide routes "who should be promoted, demoted or removed" to the facts that answer it (#260), and the deck and play examples name decks by archetype and check the collection, as the server instructions ask (#261).',
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
