/**
 * The archetype vocabulary as the record holds it (0147): card_role and
 * deck_alias rows, imported from cr-agent-api-docs at deploy, read by
 * the classifier in @elixir-mcp/contracts. One loader for the readers
 * and the operator ops, so a row is shaped into a CardRole one way.
 */

/** A card_role row as the classifier's CardRole. */
export function rowToRole(r) {
  const winCon = r.tier !== null || r.bait_tiers;
  return {
    id: r.card_id,
    name: r.name,
    ...(winCon ? { tier: r.tier === null ? null : Number(r.tier) } : {}),
    ...(r.family ? { family: r.family } : {}),
    ...(r.at_cycle_cost ? { at_cycle_cost: r.at_cycle_cost } : {}),
    ...(r.needs_partner ? { needs_partner: true } : {}),
    ...(r.pairs_with ? { pairs_with: r.pairs_with } : {}),
    ...(r.bait_tiers ? { bait_tiers: r.bait_tiers } : {}),
    ...(r.bait_unit ? { bait_unit: true } : {}),
    ...(r.bridge_partner ? { bridge_partner: true } : {}),
  };
}

/** The vocabulary in force: roles, aliases and the version row (null
 *  when nothing has been imported - every deck then names by cost). */
export async function loadVocabulary(db) {
  // One client, one query at a time (docs/ENGINEERING.md).
  const { rows: roles } = await db.query(
    `select * from card_role order by card_id`,
  );
  const { rows: aliases } = await db.query(
    `select alias, alias_key, cards, family, source from deck_alias order by alias`,
  );
  const { rows: version } = await db.query(
    `select roles_version, source_commit, imported_at from card_role_version`,
  );
  const { rows: cards } = await db.query(
    `select card_id as id, name from card where name is not null order by card_id`,
  );
  return {
    roles: roles.map(rowToRole),
    aliases,
    cards,
    version: version[0]
      ? {
          roles_version: version[0].roles_version,
          source_commit: version[0].source_commit,
          imported_at: version[0].imported_at.toISOString(),
        }
      : null,
  };
}
