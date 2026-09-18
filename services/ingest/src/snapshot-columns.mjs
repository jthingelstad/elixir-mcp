/**
 * The profile snapshot's three fixed-shape objects as columns (0123;
 * schema review 1.8), in both directions: `snapshotColumns` takes the
 * API payload apart the way the JSON columns were built from it, and
 * `snapshotObjects` puts the columns back into the objects the contract
 * serves (players_profile's path_of_legend, league_statistics and
 * lifetime), so a reader of the typed columns and a reader of the
 * objects agree by construction. The season references are the API's
 * own month names, so previous_season / best_season join `season`.
 */

const int = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function snapshotColumns(payload) {
  const cur = payload.currentPathOfLegendSeasonResult ?? null;
  const best = payload.bestPathOfLegendSeasonResult ?? null;
  const ls =
    payload.leagueStatistics && typeof payload.leagueStatistics === "object"
      ? payload.leagueStatistics
      : null;
  return {
    battle_count: int(payload.battleCount),
    wins: int(payload.wins),
    losses: int(payload.losses),
    three_crown_wins: int(payload.threeCrownWins),
    star_points: int(payload.starPoints),
    exp_points: int(payload.expPoints),
    collection_level: int(payload.collectionLevel),
    pol_league: int(cur?.leagueNumber),
    pol_trophies: int(cur?.trophies),
    pol_rank: int(cur?.rank),
    pol_best_league: int(best?.leagueNumber),
    pol_best_trophies: int(best?.trophies),
    pol_best_rank: int(best?.rank),
    season_trophies: int(ls?.currentSeason?.trophies),
    season_best_trophies: int(ls?.currentSeason?.bestTrophies),
    prev_season_month: ls?.previousSeason?.id ?? null,
    prev_season_rank: int(ls?.previousSeason?.rank),
    prev_season_trophies: int(ls?.previousSeason?.trophies),
    prev_season_best_trophies: int(ls?.previousSeason?.bestTrophies),
    best_season_month: ls?.bestSeason?.id ?? null,
    best_season_trophies: int(ls?.bestSeason?.trophies),
    best_season_rank: int(ls?.bestSeason?.rank),
  };
}

const any = (...vs) => vs.some((v) => v !== null && v !== undefined);

/** The contract's objects from a snapshot row (null where the row has
 *  nothing for that object, as the JSON was). */
export function snapshotObjects(row) {
  if (!row) return { pol: null, league_stats: null, lifetime: null };
  const polCurrent = any(row.pol_league, row.pol_trophies, row.pol_rank)
    ? {
        leagueNumber: row.pol_league,
        trophies: row.pol_trophies,
        rank: row.pol_rank,
      }
    : null;
  const polBest = any(
    row.pol_best_league,
    row.pol_best_trophies,
    row.pol_best_rank,
  )
    ? {
        leagueNumber: row.pol_best_league,
        trophies: row.pol_best_trophies,
        rank: row.pol_best_rank,
      }
    : null;
  const currentSeason = any(row.season_trophies, row.season_best_trophies)
    ? { trophies: row.season_trophies, bestTrophies: row.season_best_trophies }
    : null;
  const previousSeason = any(
    row.prev_season_month,
    row.prev_season_rank,
    row.prev_season_trophies,
    row.prev_season_best_trophies,
  )
    ? {
        id: row.prev_season_month,
        rank: row.prev_season_rank,
        trophies: row.prev_season_trophies,
        bestTrophies: row.prev_season_best_trophies,
      }
    : null;
  const bestSeason = any(
    row.best_season_month,
    row.best_season_trophies,
    row.best_season_rank,
  )
    ? {
        id: row.best_season_month,
        trophies: row.best_season_trophies,
        rank: row.best_season_rank,
      }
    : null;
  const leagueStats =
    currentSeason || previousSeason || bestSeason
      ? {
          ...(currentSeason ? { currentSeason } : {}),
          ...(previousSeason ? { previousSeason } : {}),
          ...(bestSeason ? { bestSeason } : {}),
        }
      : null;
  const lifetime = any(
    row.battle_count,
    row.wins,
    row.losses,
    row.three_crown_wins,
    row.star_points,
    row.exp_points,
    row.collection_level,
  )
    ? {
        // Both spellings until 4.0.0 (review 2026-09-19, defect 7): the
        // camelCase set is the JSON the API sent, kept for the clients
        // that read it; the snake_case set is the one clans_roster and
        // players_timeline speak, and the one that stays.
        battleCount: row.battle_count,
        wins: row.wins,
        losses: row.losses,
        threeCrownWins: row.three_crown_wins,
        starPoints: row.star_points,
        expPoints: row.exp_points,
        collectionLevel: row.collection_level,
        battle_count: row.battle_count,
        three_crown_wins: row.three_crown_wins,
        star_points: row.star_points,
        exp_points: row.exp_points,
        collection_level: row.collection_level,
      }
    : null;
  return {
    // Always an object, as the JSON was: {current, best}, each null
    // when the player has no Path of Legends result.
    pol: { current: polCurrent, best: polBest },
    league_stats: leagueStats,
    lifetime,
  };
}
