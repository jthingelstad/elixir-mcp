/** A logical player moment keeps its origin when a battle later proves it.
 * Provenance (battle_id/floor) is not the observation's identity. Existing
 * rows resolve lazily; new duplicates inherit the original row without
 * rewriting history. Aliases are internal constants, never caller input. */
const FACT_COLUMNS = [
  "card_id",
  "badge_name",
  "level",
  "prior_level",
  "max_level",
  "arena_from",
  "arena_to",
  "arena_to_name",
  "league_from",
  "league_to",
  "value_before",
  "value_after",
  "step",
];
export function playerEventOriginSql(alias) {
  return `coalesce(${alias}.origin_event_id,
    (select min(coalesce(e.origin_event_id, e.event_id)) from player_event e
      where e.player_tag = ${alias}.player_tag and e.event_type = ${alias}.event_type
        and e.window_end between ${alias}.window_end - interval '1 day' and ${alias}.window_end
        and e.event_id <= ${alias}.event_id
        and (${FACT_COLUMNS.map((c) => `e.${c}`).join(", ")}) is not distinct from
            (${FACT_COLUMNS.map((c) => `${alias}.${c}`).join(", ")})), ${alias}.event_id)`;
}

/** Best proved attachment for the logical origin, including legacy
 * duplicates that predate origin stamping. A later unproved poll cannot
 * downgrade an established proof. */
export function playerEventProofSql(origin) {
  return `select p.battle_id, p.floor, p.occurred_at, p.timing,
                 coalesce(p.evidence_version, 1) as evidence_version,
                 case when p.evidence_observed_at is null then 'legacy_window' else 'recorded_observation' end as observed_at_basis,
                 coalesce(p.evidence_observed_at, p.window_end) as evidence_observed_at
            from player_event p join player_event original on original.event_id = ${origin}
           where p.player_tag = original.player_tag and p.event_type = original.event_type
             and p.battle_id is not null
             and (${playerEventOriginSql("p")}) = ${origin}
           order by coalesce(p.evidence_version, 1) desc,
                    coalesce(p.evidence_observed_at, p.window_end) desc, p.event_id
           limit 1`;
}
