/** rankings_players · rankings_clans — the recorded leaderboards (0068).
 *
 *  The CR API shows a ranking as it is this minute and forgets it. The
 *  recorder keeps a snapshot of every board it watches — every board once
 *  a day, in the tick after 10:00Z (the global board was hourly until
 *  2026-09-11) — so these two tools can answer "who was #1 on the 3rd",
 *  "which clans have the most rated players", and hand a season story its
 *  frames. `live: true` asks for a fresh read, served if in hand or
 *  queued (1.7.0), the way clans_roster does. */

import { rankings_players } from "./rankings/players.mjs";
import { rankings_clans } from "./rankings/clans.mjs";
import { rankings_clan_ladder } from "./rankings/clan-ladder.mjs";
import { rankings_timeline } from "./rankings/timeline.mjs";
import { game_events } from "./rankings/game-events.mjs";

export const rankingsTools = {
  rankings_players,
  rankings_clans,
  rankings_clan_ladder,
  rankings_timeline,
  game_events,
};
