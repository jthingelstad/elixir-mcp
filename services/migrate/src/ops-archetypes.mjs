/**
 * Deck archetypes, operator side (docs/reviews/2026-09-20-DECK-ARCHETYPES-DESIGN.md).
 *
 * {card_roles_import}: the vocabulary (card roles and deck aliases) from
 * cr-agent-api-docs, validated the way the docs build validates it, into
 * card_role / deck_alias / card_role_version in one transaction. The
 * Lambdas have no internet, so the operator's checkout reads the sibling
 * repo and sends the rows (infra/scripts/import-card-roles.mjs); the
 * file's commit is the version.
 *
 * {archetype_census}: the grammar over the whole corpus, read-only: the
 * family distribution, the unclassified share, the top labels by
 * players, the average-elixir histograms per win condition (the cycle
 * bound is pinned from where the trough sits, design §3.3), and the
 * unattested cards that keep turning up as the defining card of a
 * fallback deck (the Understand Clash Royale queue).
 */

import pg from "pg";
import { normalizeName, FAMILIES } from "@elixir-mcp/contracts";
import { loadVocabulary, stampDecks } from "@elixir-mcp/ingest/card-roles";

const FAMILY_SET = new Set(FAMILIES.filter((f) => f !== "unclassified"));
const isUrl = (s) => typeof s === "string" && /https?:\/\//.test(s);

/** The same rules the docs build enforces: refuse a file it would refuse. */
function validateVocabulary({ roles, aliases }) {
  const problems = [];
  const seen = new Set();
  for (const r of roles ?? []) {
    const where = `role ${r?.id} ${r?.name ?? ""}`.trim();
    if (!Number.isInteger(r?.id)) problems.push(`${where}: id`);
    if (seen.has(r?.id)) problems.push(`${where}: duplicate`);
    seen.add(r?.id);
    if (!r?.name) problems.push(`${where}: name`);
    if (!isUrl(r?.source))
      problems.push(`${where}: source must be a public URL`);
    const winCon = r?.tier !== undefined || r?.bait_tiers !== undefined;
    if (winCon) {
      if (!FAMILY_SET.has(r.family)) problems.push(`${where}: family`);
      if (r.at_cycle_cost !== undefined && !FAMILY_SET.has(r.at_cycle_cost))
        problems.push(`${where}: at_cycle_cost`);
      if (r.bait_tiers === undefined && typeof r.tier !== "number")
        problems.push(`${where}: tier`);
    } else if (
      r?.bait_unit !== true &&
      r?.bridge_partner !== true &&
      r?.names_deck !== true
    ) {
      problems.push(`${where}: no role`);
    }
  }
  const keys = new Set();
  for (const a of aliases ?? []) {
    const key = normalizeName(String(a?.alias ?? ""));
    if (!key) problems.push(`alias: empty`);
    if (keys.has(key)) problems.push(`alias '${a.alias}': duplicate`);
    keys.add(key);
    if (
      !Array.isArray(a?.cards) ||
      !a.cards.length ||
      !a.cards.every(Number.isInteger)
    )
      problems.push(`alias '${a?.alias}': cards`);
    if (a?.family !== null && !FAMILY_SET.has(a?.family))
      problems.push(`alias '${a?.alias}': family`);
    if (!isUrl(a?.source))
      problems.push(`alias '${a?.alias}': source must be a public URL`);
  }
  return problems;
}

/** Replace the vocabulary with the file's contents, atomically. Cards the
 *  catalog has not seen are refused: a role for an id the record does
 *  not know is a typo, not a new card (the catalog is fetched daily). */
export async function cardRolesImport(databaseUrl, spec) {
  const { roles, aliases, roles_version, source_commit } = spec ?? {};
  if (!roles_version || !source_commit)
    throw new Error("card_roles_import needs roles_version and source_commit");
  const problems = validateVocabulary({ roles, aliases });
  if (problems.length)
    throw new Error(`vocabulary refused: ${problems.join("; ")}`);
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const ids = [
      ...new Set([
        ...roles.map((r) => r.id),
        ...aliases.flatMap((a) => a.cards),
      ]),
    ];
    const { rows: known } = await db.query(
      `select card_id from card where card_id = any($1)`,
      [ids],
    );
    const knownSet = new Set(known.map((r) => r.card_id));
    const unknown = ids.filter((id) => !knownSet.has(id));
    if (unknown.length)
      throw new Error(
        `vocabulary names cards the catalog has not seen: ${unknown.join(", ")}`,
      );
    await db.query("begin");
    await db.query("delete from deck_alias");
    await db.query("delete from card_role");
    for (const r of roles) {
      await db.query(
        `insert into card_role (card_id, name, tier, family, at_cycle_cost, needs_partner, pairs_with, bait_tiers, bait_unit, bridge_partner, names_deck, source, attested_at, roles_version)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          r.id,
          r.name,
          typeof r.tier === "number" ? r.tier : null,
          r.family ?? null,
          r.at_cycle_cost ?? null,
          r.needs_partner === true,
          r.pairs_with ? JSON.stringify(r.pairs_with) : null,
          r.bait_tiers ? JSON.stringify(r.bait_tiers) : null,
          r.bait_unit === true,
          r.bridge_partner === true,
          r.names_deck === true,
          r.source,
          r.attested_at ?? null,
          roles_version,
        ],
      );
    }
    for (const a of aliases) {
      await db.query(
        `insert into deck_alias (alias, alias_key, cards, family, source, attested_at, roles_version)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [
          a.alias,
          normalizeName(a.alias),
          a.cards,
          a.family,
          a.source,
          a.attested_at ?? null,
          roles_version,
        ],
      );
    }
    await db.query(
      `insert into card_role_version (singleton, roles_version, source_commit, imported_at, roles, aliases)
       values (true, $1, $2, now(), $3, $4)
       on conflict (singleton) do update set roles_version = excluded.roles_version,
         source_commit = excluded.source_commit, imported_at = now(),
         roles = excluded.roles, aliases = excluded.aliases`,
      [roles_version, source_commit, roles.length, aliases.length],
    );
    await db.query("commit");
    return {
      roles: roles.length,
      aliases: aliases.length,
      roles_version,
      source_commit,
    };
  } catch (error) {
    await db.query("rollback").catch(() => {});
    throw error;
  } finally {
    await db.end();
  }
}

/** Every deck in the corpus classified: distributions, histograms, the
 *  unattested queue. Read-only; aggregates only. `season` narrows the
 *  usage weighting to one season's rollup (default: the current). */

/** {archetype_stamp}: the backfill / re-stamp on demand (the nightly
 *  does the same after the rollup). Every deck behind the current
 *  grammar + vocabulary version, in batches; the census reads the
 *  stamps only through the readers, never here. */
export async function archetypeStamp(databaseUrl) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const vocab = await loadVocabulary(db);
    const result = await stampDecks(db, vocab, {});
    const { rows } = await db.query(
      `select archetype_version, count(*)::int as decks from deck group by 1 order by 2 desc`,
    );
    return { ...result, versions: rows };
  } finally {
    await db.end();
  }
}

/** {archetype_sample}: decks with their cards beside their stamped
 *  label, for a debug read - the top `per_label` decks by season battles
 *  under each of the `labels` most-played labels, the top `fallback`
 *  decks named by cost alone, and `random` decks drawn with probability
 *  proportional to battles. Read-only, this season. */
