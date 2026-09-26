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
  // Friendlies with a clanmate, and the API's own `unknown` (some
  // friendly and event battles): casual play, one answer in JS and SQL
  // (Jamie 2026-09-25; it was `other` here and `casual` in the rollups).
  clanMate: "casual",
  unknown: "casual",
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
  return MODE_GROUP_BY_TYPE[type] ?? "casual";
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

/** Battle types that are ONE participant row for up to three games, each
 *  its own round (battle_participant_round, 0151). */
export const DUEL_TYPES = ["riverRaceDuel", "riverRaceDuelColosseum"];

/**
 * A participant population as GAMES (9.11.0, feedback #363), in SQL. A
 * duel is up to three games, each with its own deck and its own result
 * (0182), and as one row with no deck it was invisible to every meta
 * count: a war deck played only in duels was in no one's war meta.
 *
 * The rows of `from` pass through as they are, `round` 0, except a
 * duel's, which becomes one row per recorded round carrying that round's
 * `deck_hash` and `outcome`; the `blank` columns (a side's level, which a
 * round does not carry) are null on a round. With `wholeDuels`, a duel
 * whose rounds were never recorded stays one row, round 0, as before:
 * the breakdown's `excluded.duels`. A decided-only read leaves it out (a
 * whole duel has no deck, so it is never decided) and keeps the
 * participant scan index-only.
 *
 * `from` is a relation or a parenthesized subquery whose columns include
 * battle_id, player_tag, type, deck_hash and outcome, each in `columns`.
 * The result is a parenthesized subquery; the caller names its alias.
 */
export function duelGamesSql(
  from: string,
  columns: readonly string[],
  {
    blank = [],
    wholeDuels = false,
  }: { blank?: readonly string[]; wholeDuels?: boolean } = {},
): string {
  const duels = `'{${DUEL_TYPES.join(",")}}'::text[]`;
  const own = columns.map((c) => `g.${c}`).join(", ");
  const perRound = columns
    .map((c) =>
      c === "deck_hash" || c === "outcome"
        ? `r.${c}`
        : blank.includes(c)
          ? `null as ${c}`
          : `g.${c}`,
    )
    .join(", ");
  const whole = wholeDuels
    ? `
     union all
     select ${own}, 0::smallint from ${from} g
      where g.type = any(${duels})
        and not exists (select 1 from battle_participant_round r
                         where r.battle_id = g.battle_id and r.player_tag = g.player_tag)`
    : "";
  return `(select ${own}, 0::smallint as round from ${from} g
      where g.type <> all(${duels})
     union all
     select ${perRound}, r.round from ${from} g
       join battle_participant_round r
         on r.battle_id = g.battle_id and r.player_tag = g.player_tag
      where g.type = any(${duels})${whole})`;
}
