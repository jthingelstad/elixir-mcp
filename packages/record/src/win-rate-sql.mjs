/**
 * The win rate's one definition, as SQL (2026-11-22): battles_performance's
 * window and the Timeline's week_form both count with these, so the two
 * doors can never disagree about a rate (packages/tools AGENTS.md, one
 * derivation).
 *
 * A decided battle is a head-to-head win or loss (`type_class = 'pvp'`):
 * boat attacks (a static defense, no live opponent) and draws stay in the
 * battle count and in W/L/D but never in the rate's denominator (feedback
 * #23). A boat DEFENSE is not the member's battle at all; callers exclude
 * it with `notBoatDefense` (`./boat-defense-sql`).
 *
 * `modeCaseSql` names each battle's mode group by the same rule the tools'
 * `mode` filter uses (`modeClause`: event content is `event`; any other
 * battle is the group its type is listed under, and an unlisted type is in
 * none), so a per-mode count here is what a one-mode read counts.
 */
import { eventContentSql, typesForModeGroup } from "@elixir-mcp/contracts";

/** The decided wins over rows with `outcome` and `type_class` columns. */
export const decidedWinsSql = (outcome = "outcome", typeClass = "type_class") =>
  `count(*) filter (where ${outcome} = 'win' and ${typeClass} = 'pvp')`;

/** The decided losses, as decidedWinsSql. */
export const decidedLossesSql = (
  outcome = "outcome",
  typeClass = "type_class",
) => `count(*) filter (where ${outcome} = 'loss' and ${typeClass} = 'pvp')`;

/** decided_wins / decided_battles to three places, null when none. */
export const winRate = (decidedWins, decided) =>
  decided > 0 ? Number((decidedWins / decided).toFixed(3)) : null;

const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** A battle's mode group among `modes` (null outside them), from its
 *  `type` and `event_tag` columns, as the tools' `mode` filter reads one. */
export function modeCaseSql(modes, typeCol = "b.type", tagCol = "b.event_tag") {
  const event = eventContentSql(typeCol, tagCol);
  const arms = modes
    .filter((m) => m !== "event")
    .map((m) => {
      const types = typesForModeGroup(m);
      return types.length
        ? `when ${typeCol} in (${types.map(quote).join(", ")}) then ${quote(m)}`
        : null;
    })
    .filter(Boolean);
  return `case when ${event} then ${modes.includes("event") ? "'event'" : "null"}
               ${arms.join(" ")} else null end`;
}
