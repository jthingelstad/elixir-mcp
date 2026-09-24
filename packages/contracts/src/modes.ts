/**
 * Battle mode grouping — contract vocabulary: `battles_query`/
 * `battles_performance` accept `mode` as one of these groups, and the rollup
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

/**
 * Event content is its own group, decided by the API's own `eventTag`
 * rather than by the battle type (Jamie 2026-09-22: "game modes are
 * really played as a different game").
 *
 * `type: "trail"` carries an eventTag on 100% of 123,562 recorded
 * battles and every permanent format carries one on 0%, so the tag - not
 * the type and not the mode name - is what separates a time-bound event
 * from a format that is always there. `trail` used to fold into
 * `casual`, which filed the Seasonal Trophy Road (whose decks are
 * boosted to Seasonal Arena II's Level 15 floor: mean 15.87 against
 * 13.67 on Trophy Road) as casual play, and pooled a fortnight's 2v2
 * tournament with it.
 *
 * `event` is a coarse FILTER, never a population: one event is not
 * another. `trail`+`TeamVsTeam` alone has carried ten distinct event
 * tags. A rate over event content must key on the event_tag itself.
 */
export const EVENT_MODE_GROUP = "event";

export function modeGroupOf(type: string, eventTag?: string | null): string {
  if (eventTag) return EVENT_MODE_GROUP;
  return MODE_GROUP_BY_TYPE[type] ?? "other";
}

export const MODE_GROUPS = [
  ...new Set([...Object.values(MODE_GROUP_BY_TYPE), EVENT_MODE_GROUP]),
].sort();

export function typesForModeGroup(group: string): string[] {
  return Object.entries(MODE_GROUP_BY_TYPE)
    .filter(([, g]) => g === group)
    .map(([t]) => t);
}

/**
 * The same rule in SQL, so the rollup writers cannot drift from the
 * readers. `b` is the alias of the battle table (or of a participant row
 * carrying `type`), `tagCol` the event_tag column to test.
 */
export function modeGroupSql(typeCol: string, tagCol: string): string {
  const cases = Object.entries(MODE_GROUP_BY_TYPE)
    .map(([t, g]) => `when '${t}' then '${g}'`)
    .join(" ");
  return `case when ${tagCol} is not null then '${EVENT_MODE_GROUP}'
               else (case ${typeCol} ${cases} else 'casual' end) end`;
}

/**
 * Battle types whose starting trophies are not Trophy Road trophies, so
 * they sit in no trophy band. Path of Legends carries its rating (Gym
 * #102); a tournament row carries the player's running score in that
 * tournament, counting 1, 2, 3 on consecutive battles, which filed 3,313
 * tournament battles as 89.6% of under_5000 (Gym #191).
 */
export function unbandedTypes(): string[] {
  return [...typesForModeGroup("ranked"), ...typesForModeGroup("tournament")];
}
