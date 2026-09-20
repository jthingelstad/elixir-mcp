/**
 * The archetype vocabulary as the record holds it (0147): card_role and
 * deck_alias rows, imported from cr-agent-api-docs at deploy, read by
 * the classifier in @elixir-mcp/contracts. One loader for the readers
 * and the operator ops, so a row is shaped into a CardRole one way.
 */

import { classifyDeck, GRAMMAR_VERSION } from "@elixir-mcp/contracts";

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

/** The vocabulary, cached per connection for five minutes: it changes
 *  at a deploy, and every deck object and every ingested deck needs it. */
const VOCABULARY_TTL_MS = 5 * 60_000;
const vocabularyCache = new WeakMap();
export async function cachedVocabulary(db) {
  const hit = vocabularyCache.get(db);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = await loadVocabulary(db);
  vocabularyCache.set(db, { value, until: Date.now() + VOCABULARY_TTL_MS });
  return value;
}

/** The version a stamp is computed under: the grammar's and the
 *  vocabulary's, as one string the nightly compares. */
function stampVersion(vocab) {
  return `${GRAMMAR_VERSION}|${vocab.version?.roles_version ?? "none"}`;
}

/** Stamp the archetype on decks (0148): the given hashes, or every row
 *  whose version is behind the current one, in batches. An unchanged
 *  stamp writes nothing (re-ingest leaves row versions where they were).
 *  Returns how many rows were considered. */
export async function stampDecks(
  db,
  vocab,
  { hashes = null, batch = 2000 } = {},
) {
  const version = stampVersion(vocab);
  let written = 0;
  for (;;) {
    const { rows } = await db.query(
      hashes
        ? `select d.deck_hash,
                  jsonb_agg(jsonb_build_object('id', dc.card_id, 'name', c.name, 'form', dc.form, 'elixir_cost', c.elixir_cost) order by dc.card_id) as cards
           from deck d
           join deck_card dc on dc.deck_hash = d.deck_hash
           join card c on c.card_id = dc.card_id
           where d.deck_hash = any($1)
           group by d.deck_hash`
        : `select d.deck_hash,
                  jsonb_agg(jsonb_build_object('id', dc.card_id, 'name', c.name, 'form', dc.form, 'elixir_cost', c.elixir_cost) order by dc.card_id) as cards
           from deck d
           join deck_card dc on dc.deck_hash = d.deck_hash
           join card c on c.card_id = dc.card_id
           where d.archetype_version is distinct from $1
           group by d.deck_hash
           limit $2`,
      hashes ? [hashes] : [version, batch],
    );
    if (rows.length === 0) break;
    const stamps = rows.map((r) => {
      const a = classifyDeck(r.cards, vocab.roles);
      return {
        deck_hash: r.deck_hash,
        family: a.family,
        label: a.label,
        win_conditions: a.win_conditions.map((w) => w.id),
      };
    });
    await db.query(
      `update deck d set
         archetype_family = s.family,
         archetype_label = s.label,
         archetype_win_conditions = s.win_conditions,
         archetype_version = $2
       from jsonb_to_recordset($1::jsonb)
         as s(deck_hash text, family text, label text, win_conditions int[])
       where d.deck_hash = s.deck_hash
         and (d.archetype_version is distinct from $2
              or d.archetype_label is distinct from s.label
              or d.archetype_family is distinct from s.family
              or d.archetype_win_conditions is distinct from s.win_conditions)`,
      [JSON.stringify(stamps), version],
    );
    written += stamps.length;
    if (hashes || rows.length < batch) break;
  }
  return { written, version };
}
