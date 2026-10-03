/** Retired capture sources remain recognizable for old leases and archives. */
export const RETIRED_RECORDING_ENDPOINTS = [
  "rankings_players",
  "rankings_pol",
  "rankings_pol_season",
  "rankings_clans_loc",
  "rankings_clanwars",
  "leaderboards",
  "leaderboard",
] as const;

export function isRetiredRecordingEndpoint(endpoint: string): boolean {
  return (RETIRED_RECORDING_ENDPOINTS as readonly string[]).includes(endpoint);
}
