import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.2.0",
  date: "2026-09-20",
  summary: md(
    "The rankings family, after the Elixir Gym's regression run (feedback #71-#74 and #76, 2026-09-20). The material one is a label: the live Path of Legends board is the API's top 1,000 (probed: limit=5 returns a cursor, limit=1000 and 2000 return 1,000 rows with none, and a cursor at position 1000 returns an empty page) and every surface that served it described a rating floor. The recorder stores exactly what the API returns (Iceland's board is two rows); nothing was dropped, and the cutoff rising through a season is correct - the word was wrong.",
    list(
      "`snapshot.depth` (1,000 on a live board, 9,999 on a season final) and `snapshot.full` on `rankings_players`, `rankings_clans` and `rankings_clan_ladder`; `snapshot.floor_rating` (the last place's rating) on the player boards. A full board carries a note saying whose cut it is (`truncated: false` there means the API served nothing past depth) and that `floor_rating` is a cutoff that moves, not a qualification threshold: a player or clan can leave the board without losing rating. The standing floor note describes both regimes, and the two 'rated_players rises through a season' clauses are gone - it moves with the cutoff as well as with play, and can fall while every one of a clan's players improves.",
      "`rankings_timeline`: the board curve's points carry `depth`, `full` and `floor_delta` (the cutoff's move since the previous point); a clan's points carry `board_full` and `board_floor_rating` beside `rated_players`; a note counts the points at depth. A season final is described as the API's 9,999 places, cut mid-tie (S135 ends in a nine-way tie at #9999), not 'full depth'.",
      "`rankings_timeline` names the recording horizon (feedback #72): `meta.recorded_since` on every rankings read, and a window that starts a day or more before the board's first snapshot echoes `applied.window.partial: true` with `covers` (the recorded span, or null when none of the window is) and a note - 'unrecorded for the window, not unchanged' when the series is empty, 'covers 2026-09-11 onward' when it is clipped. `rankings_players` and `rankings_clans` read the horizon from the table on an `as_of` before it, instead of a date in the code; `rankings_clans` gains the as_of sentence it lacked.",
      "`pol_final` (feedback #73): `applied.season` is always echoed (the resolved ordinal, or null) with `season_requested` beside it, and a miss says which of four things it is - a season that has not happened (naming the current one), the season in progress (naming when its final is fetched), a season before the ranked ladder began at S89 (the number a player reads off the in-game Pass, with the pointer to game_clock), or a settled season the schedule has not fetched yet. No `pol_final` note offers `live: true`, which the tool refuses.",
      "Every published input schema declares `verbosity` (feedback #74): the eleven two-size tools in their own words, the rest as accepted-and-ignored. 6.0.0 accepted the argument server-side while the schemas still said `additionalProperties: false` without it, so a client that validates arguments before dispatch refused the call locally and never saw the note.",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
