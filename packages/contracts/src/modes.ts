/**
 * Battle mode grouping — contract vocabulary: `battles_query`/
 * `battles_performance` accept `mode` as one of these groups, and the rollup
 * tables bucket by them. One mapping, shared by tools and ingest.
 */

export const MODE_GROUP_BY_TYPE: Record<string, string> = {
  PvP: "ladder",
  pathOfLegend: "ranked",
  // Fallback for an untagged trail row only; eventTag decides `event`.
  // The tag stays the rule (Gym #187, 2026-09-23).
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
 * The rule decides the mode GROUP only.
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

/** The river race duel types (0151). Not every duel: the API sends any
 *  battle played as games on round decks with rounds[] (an event's
 *  multi-deck mode, the 1v1 Duel friendly), and ingest stores each
 *  game's row in battle_participant_round whatever the type. A reader
 *  asks isDuelBattle / duelSql, never this list alone. */
export const DUEL_TYPES = ["riverRaceDuel", "riverRaceDuelColosseum"];

/**
 * THE duel rule, one for every reader (MCP 13.0.2, 13.1.0): a battle is
 * a duel, ONE row for up to three games each on its own deck, when its
 * type is a river race duel OR the record holds its round decks. The
 * type keeps a river race duel recorded before the rounds were kept a
 * duel; the round rows catch every other type the API sent rounds[]
 * for. `hasRounds` is whether the read holds round decks for it.
 */
export function isDuelBattle(
  type: string | null | undefined,
  hasRounds = false,
): boolean {
  return DUEL_TYPES.includes(String(type ?? "")) || hasRounds === true;
}

/**
 * `isDuelBattle` in SQL: `typeCol` is the battle's (or a participant
 * row's) type, `battleIdCol` the battle_id to look for round rows under.
 */
export function duelSql(typeCol: string, battleIdCol: string): string {
  return `(${typeCol} = any('{${DUEL_TYPES.join(",")}}'::text[])
          or exists (select 1 from battle_participant_round duel_r
                      where duel_r.battle_id = ${battleIdCol}))`;
}

/**
 * A participant population as GAMES (9.11.0, feedback #363), in SQL. A
 * duel is up to three games, each with its own deck and its own result
 * (0182), and as one row with no deck it was invisible to every meta
 * count: a war deck played only in duels was in no one's war meta.
 *
 * Every row of `from` passes through as it is, `round` 0, a duel's whole
 * row among them; and each recorded round of a duel is added as a row of
 * its own, `round` 1-3, carrying that round's `deck_hash` and `outcome`.
 * A duel here is `isDuelBattle`: a row's round rows are its games
 * whatever its type (13.1.0: an event's multi-deck duel added only its
 * whole row, so its cards counted nowhere). A river race duel recorded
 * before the rounds were kept has no round rows, so adds nothing.
 * The `blank` columns (a side's level, which a round does not carry) are
 * null on a round. So a count of BATTLES reads `round = 0` (a duel once,
 * as every other tool counts it), and a count of decided GAMES reads the
 * rows with a deck: a duel's whole row has none, so it is never decided,
 * and its rounds are.
 *
 * `from` is a relation or a parenthesized subquery whose columns include
 * battle_id, player_tag, deck_hash and outcome, each in `columns`.
 * The result is a parenthesized subquery; the caller names its alias.
 */
export function duelGamesSql(
  from: string,
  columns: readonly string[],
  { blank = [] }: { blank?: readonly string[] } = {},
): string {
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
         on r.battle_id = g.battle_id and r.player_tag = g.player_tag)`;
}
