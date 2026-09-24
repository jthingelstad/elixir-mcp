/**
 * The mode filter a participant-only query applies (feedback #148).
 *
 * `event` is the API's eventTag on the battle row, not a set of types:
 * event battles come as `trail` and as `unknown` (a live read,
 * 2026-09-23), so `bp.type = any(typesForModeGroup(mode))` matched
 * nothing for event and let event-tagged battles into casual. The tag
 * is read through a semi-join, only when a mode is named, so the
 * unfiltered scans keep their shape.
 */

import { EVENT_MODE_GROUP, typesForModeGroup } from "@elixir-mcp/contracts";

const eventExists = (alias) =>
  `exists (select 1 from battle mb where mb.battle_id = ${alias}.battle_id and mb.event_tag is not null)`;

/** SQL for "this participant row's battle is in mode group `mode`",
 *  pushing the types onto `params` when it needs them. */
export function participantModeClause(mode, params, alias = "bp") {
  if (mode === EVENT_MODE_GROUP) return eventExists(alias);
  params.push(typesForModeGroup(mode));
  return `${alias}.type = any($${params.length}) and not ${eventExists(alias)}`;
}

/** The meta population (6.17.0, Jamie): no event content, and only a deck
 *  the player chose (a null deck_selection is kept). The season rollup
 *  applies it at write (META_POPULATION in jobs/meta-rollup.mjs); a raw
 *  window read applies it here, or a custom window answered a different
 *  population than the season it sits in. */
export const metaPopulationClause = (alias = "bp") =>
  `exists (select 1 from battle mb where mb.battle_id = ${alias}.battle_id
             and mb.event_tag is null
             and (mb.deck_selection is null or mb.deck_selection in ('collection', 'warDeckPick')))`;

/** The note a meta tool serves for mode event: excluded by decision. */
export const META_EVENT_NOTE =
  "Event battles are not in the meta population: a drafted, restricted or level-boosted event deck describes the event, not the meta (6.17.0). Read them with battles_decks or battles_query mode event.";

/** How many battles a raw meta read left OUT as outside the meta
 *  population (Gym #188): the same segment, window, mode and band, minus
 *  the population clause, counted where the population rule fails. A
 *  player whose week was nearly all event battles read "considered 10,
 *  no decks" with nothing saying why. */
export async function outsideMetaCount(db, scope, params) {
  const clause = metaPopulationClause();
  const rest = scope.filter((w) => w !== clause);
  const { rows } = await db.query(
    `select count(*)::int as n from battle_participant bp${
      rest.some((w) => /\bb\./.test(w))
        ? " join battle b on b.battle_id = bp.battle_id"
        : ""
    }
      where ${[...rest, `not ${clause}`].join(" and ")}`,
    params,
  );
  return rows[0]?.n ?? 0;
}

/** The disclosure beside a raw meta read that left battles out (#188). */
export function outsideMetaNote(n) {
  return n > 0
    ? `${n} battle${n === 1 ? "" : "s"} in this window ${n === 1 ? "is" : "are"} outside the meta population and not counted anywhere above (excluded.outside_meta): event battles and decks the player did not choose (6.17.0). battles_query and battles_decks read them.`
    : null;
}
