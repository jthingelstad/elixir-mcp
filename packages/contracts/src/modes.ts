/**
 * Battle mode grouping — contract vocabulary: `battles_query`/
 * `battles_performance` accept `mode` as one of these groups, and the rollup
 * tables bucket by them. One mapping, shared by tools and ingest.
 */

export const MODE_GROUP_BY_TYPE: Record<string, string> = {
  PvP: "ladder",
  pathOfLegend: "ranked",
  // Fallback for an untagged trail row only; eventTag decides `event`. Mapping
  // trail to "event" here trips meta_season_pop's mode_group CHECK (0140), so
  // the tag stays the rule (Gym #187, 2026-09-23).
  trail: "casual",
  riverRacePvP: "war",
  riverRaceDuel: "war",
  riverRaceDuelColosseum: "war",
  boatBattle: "war",
  clanMate2v2: "casual",
  // Friendlies with a clanmate, and the API's own `unknown` (some
  // friendly and event battles): casual play, one answer in JS and SQL
  // (Jamie 2026-09-25; it was `other` here and `casual` in the rollups).
  // A clanmate battle stays casual even when tagged; a tagged `unknown`
  // is event content (CLANMATE_TYPES below; Jamie 2026-09-28, #109).
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

/**
 * A battle with a clanmate is casual play even when it carries an event
 * tag (Jamie 2026-09-28, #109): about 62% of clanmate friendlies carry
 * one, because friends play a friendly under an event's rules. Every
 * other tagged battle is event content, the API's own `unknown` included
 * (Royale Shuffle comes as `unknown` with a tag, and the game lists it
 * under Game Modes as a timed event). An untagged `unknown` stays casual.
 *
 * The rule decides the mode GROUP only. The meta population still leaves
 * out every tagged battle, a clanmate's too (META_POPULATION in
 * services/jobs/src/meta-rollup.mjs): a deck played under an event's
 * rules describes the event, not the meta.
 */
export const CLANMATE_TYPES: readonly string[] = ["clanMate", "clanMate2v2"];

/** Whether a battle is event content: tagged, and not with a clanmate. */
export function isEventContent(
  type: string,
  eventTag?: string | null,
): boolean {
  return Boolean(eventTag) && !CLANMATE_TYPES.includes(type);
}

export function modeGroupOf(type: string, eventTag?: string | null): string {
  if (isEventContent(type, eventTag)) return EVENT_MODE_GROUP;
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
 * `isEventContent` in SQL: true for a tagged battle that is not a
 * clanmate's. `typeCol` and `tagCol` are the columns to test (the
 * battle's own `type` or a participant row's, and battle.event_tag).
 */
export function eventContentSql(typeCol: string, tagCol: string): string {
  const clanmate = CLANMATE_TYPES.map((t) => `'${t}'`).join(", ");
  return `(${tagCol} is not null and ${typeCol} not in (${clanmate}))`;
}

/**
 * The same rule in SQL, so the rollup writers cannot drift from the
 * readers. `typeCol` is the battle's `type` (or a participant row's),
 * `tagCol` the event_tag column to test. A test pins it equal to
 * `modeGroupOf` for every type, tagged and untagged.
 */
export function modeGroupSql(typeCol: string, tagCol: string): string {
  const cases = Object.entries(MODE_GROUP_BY_TYPE)
    .map(([t, g]) => `when '${t}' then '${g}'`)
    .join(" ");
  return `case when ${eventContentSql(typeCol, tagCol)} then '${EVENT_MODE_GROUP}'
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
 * Every row of `from` passes through as it is, `round` 0, a duel's whole
 * row among them; and each recorded round of a duel is added as a row of
 * its own, `round` 1-3, carrying that round's `deck_hash` and `outcome`.
 * The `blank` columns (a side's level, which a round does not carry) are
 * null on a round. So a count of BATTLES reads `round = 0` (a duel once,
 * as every other tool counts it), and a count of decided GAMES reads the
 * rows with a deck: a duel's whole row has none, so it is never decided,
 * and its rounds are.
 *
 * `from` is a relation or a parenthesized subquery whose columns include
 * battle_id, player_tag, type, deck_hash and outcome, each in `columns`.
 * The result is a parenthesized subquery; the caller names its alias.
 */
export function duelGamesSql(
  from: string,
  columns: readonly string[],
  { blank = [] }: { blank?: readonly string[] } = {},
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
  return `(select ${own}, 0::smallint as round from ${from} g
     union all
     select ${perRound}, r.round from ${from} g
       join battle_participant_round r
         on r.battle_id = g.battle_id and r.player_tag = g.player_tag
      where g.type = any(${duels}))`;
}
