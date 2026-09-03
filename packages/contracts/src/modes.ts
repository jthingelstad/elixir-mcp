/**
 * Battle mode grouping — contract vocabulary: `query_battles`/
 * `get_performance` accept `mode` as one of these groups, and the rollup
 * tables bucket by them. One mapping, shared by tools and ingest.
 */

export const MODE_GROUP_BY_TYPE: Record<string, string> = {
  PvP: "ladder",
  pathOfLegend: "ranked",
  trail: "casual",
  riverRacePvP: "war",
  riverRaceDuel: "war",
  riverRaceDuelColosseum: "war",
  boatBattle: "war",
  clanMate2v2: "casual",
  friendly: "casual",
  challenge: "challenge",
  tournament: "tournament",
};

export const MODE_GROUPS = [
  ...new Set(Object.values(MODE_GROUP_BY_TYPE)),
].sort();

export function typesForModeGroup(group: string): string[] {
  return Object.entries(MODE_GROUP_BY_TYPE)
    .filter(([, g]) => g === group)
    .map(([t]) => t);
}
