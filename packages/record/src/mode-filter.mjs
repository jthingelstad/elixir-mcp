/**
 * The mode filter a participant-only query applies (feedback #148).
 *
 * `event` is the API's eventTag on the battle row, not a set of types:
 * event battles come as `trail` and as `unknown` (a live read,
 * 2026-09-23), so `bp.type = any(typesForModeGroup(mode))` matched
 * nothing for event and let event-tagged battles into casual. A
 * clanmate battle is casual even when tagged (#109), so the event test
 * is `eventContentSql` over the participant's own type. The tag is read
 * through a semi-join, only when a mode is named, so the unfiltered
 * scans keep their shape.
 */

import {
  EVENT_MODE_GROUP,
  eventContentSql,
  typesForModeGroup,
} from "@elixir-mcp/contracts";

const eventExists = (alias) =>
  `exists (select 1 from battle mb where mb.battle_id = ${alias}.battle_id
             and ${eventContentSql(`${alias}.type`, "mb.event_tag")})`;

/** SQL for "this participant row's battle is in mode group `mode`",
 *  pushing the types onto `params` when it needs them. */
export function participantModeClause(mode, params, alias = "bp") {
  if (mode === EVENT_MODE_GROUP) return eventExists(alias);
  params.push(typesForModeGroup(mode));
  return `${alias}.type = any($${params.length}) and not ${eventExists(alias)}`;
}
