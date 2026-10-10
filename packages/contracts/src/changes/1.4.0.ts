import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "1.4.0",
  date: "2026-09-11",
  summary:
    "Everything else the API forgets about a season. FINALS: rankings_players and rankings_clans take board: pol_final with a season id - every Path of Legends season's final standing at full depth (9,999 places) since S97, backfilled, and each season's final fetched the day after it rolls. GAME-MODE BOARDS: board: mode with the leaderboard id as location (Merge Tactics, Touchdown, 2v2 League...), enumerated from the API daily so a rotating board is followed, never named. CLAN LADDERS: rankings_clan_ladder reads the clans (clan score) and clanwars (clan war trophies) boards by location, 1,000 places, daily. MOVEMENT: rankings_timeline is a player's rank and rating, a clan's rated players and best rank, or the board's own floor, summit and field size at every snapshot across a window - the season story at hourly resolution. WHAT WAS ON: game_events is the in-game events the API listed as running, recorded daily with the days each was seen, since the API gives no dates. FIX: every board's freshness is now stamped on admission; from 0068's deploy until this one the boards were re-planned every fifteen minutes as starved (~1,500 fetches an hour), which this ends.",
  tools_added: ["rankings_clan_ladder", "rankings_timeline", "game_events"],
} satisfies ChangelogEntry;
