import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "8.0.0",
  date: "2026-09-24",
  summary: md(
    "The major before open beta (Jamie, 2026-09-24): two breaking changes, nothing else.",
    list(
      '`rankings_players`, `rankings_clans` and `rankings_clan_ladder` serve the snapshot\'s `season_id` as a number, like every other `season_id` (it was the string "135" beside `applied.season` 135 in the same response) (#345).',
      "`battles_meta_decks` `min_players` counts **repeat players**, those with two or more battles on the deck, carried on every row as `repeat_players`; `players` stays every distinct player. Two players who tried a deck once no longer carry one player's deck past `min_players: 2` (#348). A season rollup row not yet rebuilt is judged on `players` until the nightly, and a note says so.",
    ),
  ),
  breaking:
    "A client parsing rankings season_id as a string, or relying on min_players counting one-battle players, must update. Every first-party client was checked: none reads either.",
} satisfies ChangelogEntry;
