/**
 * Ranked (Path of Legends) league names for the API's `leagueNumber`.
 *
 * The API names no league. Since the July 2025 update removed Challenger
 * I-III, Ranked has seven leagues, 1 Master I to 7 Ultimate Champion
 * (`../cr-agent-api-docs/game-modes.md`, "Leagues and `leagueNumber`").
 * Name a current or last season's result, a recorded season
 * (`player_pol_season`) or a battle's league with it; never a profile's
 * best, which can be on the earlier ten-league scale (8 to 10 are seen,
 * and a best of 1 to 7 could be either).
 */
export const RANKED_LEAGUES = Object.freeze({
  1: "Master I",
  2: "Master II",
  3: "Master III",
  4: "Champion",
  5: "Grand Champion",
  6: "Royal Champion",
  7: "Ultimate Champion",
});

/** The league's name, or null for anything but an integer 1 to 7. */
export const rankedLeagueName = (n) =>
  Number.isInteger(n) && Object.hasOwn(RANKED_LEAGUES, n)
    ? RANKED_LEAGUES[n]
    : null;
