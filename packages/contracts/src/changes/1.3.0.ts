import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "1.3.0",
  date: "2026-09-11",
  summary:
    "The leaderboards are recorded. rankings_players reads a board - the global Path of Legends board by default, any of the 262 locations by id or country code - as of the latest snapshot or any earlier instant (as_of), paged with limit and offset, verbosity compact for rank/tag/rating only. rankings_clans aggregates a board into the clans with the most rated players, ties broken by the clan's best-placed player, counted over everyone above the rating floor rather than a top-100 slice. The global board is recorded hourly and every location daily; live: true on either reads the game first and records what it read. A top-200 appearance on the global board now RECORDS the player at comprehensive scope until the next season roll plus three days (a new recording reason, 'ranked', beside claims, clan watches and collections). live_fetch on a rankings path now returns up to 1000 places instead of 100.",
  tools_added: ["rankings_players", "rankings_clans"],
} satisfies ChangelogEntry;
