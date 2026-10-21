/**
 * Ranked (Path of Legends) league names for the API's `leagueNumber`.
 *
 * The API names no league. Since the July 2025 update removed Challenger
 * I-III, Ranked has seven leagues, 1 Master I to 7 Ultimate Champion
 * (`../cr-agent-api-docs/game-modes.md`, "Leagues and `leagueNumber`").
 * Name a battle's league or a current reading with it; a season's
 * result goes through `seasonResultLeague`.
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

/** Ultimate Champion: the top league, and the only rated one. */
export const ULTIMATE_CHAMPION = 7;

/**
 * A Path of Legends season result's league, `{ league, name }`, or null
 * when the result cannot name one (cr-agent-api-docs `game-modes.md`,
 * observed 2026-10-20 over 249 players). Only Ultimate Champion is
 * rated, on either league scale, so a result with `trophies` above 0 is
 * Ultimate Champion whatever its `leagueNumber` (a best of 10 is the
 * earlier scale's). Unrated, a season's result (a recorded final) names
 * 2 to 6, never 1: a player who did not play that season reads 1 with 0
 * too. An unrated `best` (`{ best: true }`) names nothing, since it can
 * be on the earlier scale.
 */
export function seasonResultLeague(
  { league, trophies },
  { best = false } = {},
) {
  if (typeof trophies === "number" && trophies > 0)
    return {
      league: ULTIMATE_CHAMPION,
      name: RANKED_LEAGUES[ULTIMATE_CHAMPION],
    };
  if (best || league === 1 || league === ULTIMATE_CHAMPION) return null;
  const name = rankedLeagueName(league);
  return name ? { league, name } : null;
}
