/**
 * The win rate's one definition (2026-11-22): every `win_rate` Elixir
 * serves counts with these (battles_performance's window, its weeks and
 * its modes, battles_decks, battles_cards, players_summary,
 * clans_standings, Scout's log, the Timeline's week_form), so no two doors
 * can disagree about a rate (packages/tools AGENTS.md, one derivation).
 * `services/mcp/test/win-rate-one-definition.test.mjs` refuses a rate
 * computed anywhere else.
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

/** The same rule over a battle row a reader already holds (a prospect's
 *  log from battles_query): a win or a loss that is not a boat battle,
 *  by the test ingest stamps `type_class` with (`battles.mjs`). */
export const isDecided = (outcome, type) =>
  (outcome === "win" || outcome === "loss") &&
  !String(type ?? "").startsWith("boatBattle");

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
