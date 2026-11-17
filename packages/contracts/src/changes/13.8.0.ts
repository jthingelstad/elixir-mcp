import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "13.8.0",
  date: "2026-11-17",
  summary: md(
    'The timeline says how a followed player finished a Ranked season: "Pip finished the Ranked season in Master III."',
    list(
      "`elixir_timeline`: a new item kind, `ranked_season_finished` (`ranked` section; `facts.season` the season's month, `facts.league` and `facts.league_name` the final league, `facts.rating` the rating in Ultimate Champion and `null` below it; never a global rank). `at` is the season's end; `observed_at` is the read that saw the player's profile roll into the next season, hours or days later. Said once, only for a player the record read before the season ended, and in Master I only when the record holds a Ranked battle from that season. A player's own item: never on a clan's timeline, where every member would say it on one morning.",
      "`elixir_timeline`: a player whose window held only a moment that the entry does not count (a season's finish, a maxed card, a deck switch, a King Tower level, a challenge run) is no longer listed in `quiet` with the item dropped.",
      "`players_profile` and every reader of a season's Ranked result: a result is filed only once the player's profile has rolled into the next season. A profile read in the hours after the season hour still carries the season before, and was filed under the season that had just closed; such a row is corrected by the next daily read.",
      "`deck_switched`: `observed_at` is the battle-log read that delivered the third battle, so a poller whose pointer passed that battle before the read still sees the switch.",
    ),
    "Additive. The JSON API is unchanged at 5.1.0.",
  ),
} satisfies ChangelogEntry;
