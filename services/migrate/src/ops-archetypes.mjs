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
import {
  classifyDeck,
  normalizeName,
  FAMILIES,
  CYCLE_MAX,
  BEATDOWN_MIN,
  GRAMMAR_VERSION,
} from "@elixir-mcp/contracts";
import { rowToRole } from "../../ingest/src/card-roles.mjs";

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
    } else if (r?.bait_unit !== true && r?.bridge_partner !== true) {
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
        `insert into card_role (card_id, name, tier, family, at_cycle_cost, needs_partner, pairs_with, bait_tiers, bait_unit, bridge_partner, source, attested_at, roles_version)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
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
export async function archetypeCensus(databaseUrl, spec = {}) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows: roles } = await db.query(`select * from card_role`);
    const roleList = roles.map(rowToRole);
    // The season in progress (the table is seeded ahead of the clock).
    const { rows: seasonRow } = await db.query(
      `select season_month from season where starts_at <= now() order by season_month desc limit 1`,
    );
    const seasonMonth = spec.season ?? seasonRow[0]?.season_month ?? null;
    // Every deck's cards with cost, plus this season's battles and
    // players (mode 'all') where the rollup has the deck.
    const { rows } = await db.query(
      `select d.deck_hash,
              jsonb_agg(jsonb_build_object('id', dc.card_id, 'name', c.name, 'form', dc.form, 'elixir_cost', c.elixir_cost) order by dc.card_id) as cards,
              coalesce(m.battles, 0) as battles, coalesce(m.players, 0) as players
       from deck d
       join deck_card dc on dc.deck_hash = d.deck_hash
       join card c on c.card_id = dc.card_id
       left join deck_meta_season m on m.deck_hash = d.deck_hash and m.season_month = $1 and m.mode_group = 'all'
       group by d.deck_hash, m.battles, m.players`,
      [seasonMonth],
    );
    const families = {};
    const labels = new Map();
    const histograms = new Map(); // win-condition id -> { name, bins: {bin: {decks, battles}} }
    const unattested = new Map(); // card id -> { name, decks, battles }
    const byId = new Map(roleList.map((r) => [r.id, r]));
    let decks = 0;
    let weighted = 0;
    for (const r of rows) {
      const cards = r.cards;
      const a = classifyDeck(cards, roleList);
      decks += 1;
      const w = Number(r.battles);
      weighted += w;
      const f = (families[a.family] ??= { decks: 0, battles: 0, players: 0 });
      f.decks += 1;
      f.battles += w;
      f.players += Number(r.players);
      const l = labels.get(a.label) ?? {
        label: a.label,
        family: a.family,
        decks: 0,
        battles: 0,
        players: 0,
      };
      l.decks += 1;
      l.battles += w;
      l.players += Number(r.players);
      labels.set(a.label, l);
      // The histogram per win condition PRESENT in the deck (not only the
      // anchoring one): where the average elixir sits when the card is
      // in the deck is the question the cycle bound asks.
      // Bins are the average itself: with eight cards it steps by an
      // eighth, so a tenth-wide bin is empty three times in every unit.
      if (a.average_elixir !== null) {
        const bin = a.average_elixir.toFixed(3);
        for (const c of cards) {
          const role = byId.get(c.id);
          if (!role || (role.tier === undefined && !role.bait_tiers)) continue;
          const h = histograms.get(c.id) ?? { name: role.name, bins: {} };
          const b = (h.bins[bin] ??= { decks: 0, battles: 0 });
          b.decks += 1;
          b.battles += w;
          histograms.set(c.id, h);
        }
      }
      // A fallback deck's defining card: its most expensive card with no
      // role. Counted so the unattested queue is ranked by evidence.
      if (a.win_conditions.length === 0) {
        // Troops and buildings only: a spell is never a win condition
        // (Lightning led the first census's queue).
        const candidates = cards
          .filter(
            (c) =>
              !byId.has(c.id) &&
              typeof c.elixir_cost === "number" &&
              c.id < 28000000,
          )
          .sort((x, y) => y.elixir_cost - x.elixir_cost || x.id - y.id);
        const top = candidates[0];
        if (top) {
          const u = unattested.get(top.id) ?? {
            id: top.id,
            name: top.name,
            decks: 0,
            battles: 0,
          };
          u.decks += 1;
          u.battles += w;
          unattested.set(top.id, u);
        }
      }
    }
    const share = (n, d) => (d > 0 ? Number((n / d).toFixed(4)) : null);
    return {
      grammar_version: GRAMMAR_VERSION,
      bounds: { cycle_max: CYCLE_MAX, beatdown_min: BEATDOWN_MIN },
      roles: roleList.length,
      season: seasonMonth,
      decks,
      battles_in_season: weighted,
      families: Object.fromEntries(
        Object.entries(families).map(([k, v]) => [
          k,
          {
            ...v,
            deck_share: share(v.decks, decks),
            battle_share: share(v.battles, weighted),
          },
        ]),
      ),
      top_labels: [...labels.values()]
        .sort((x, y) => y.players - x.players || y.battles - x.battles)
        .slice(0, spec.top ?? 40),
      histograms: Object.fromEntries(
        [...histograms.entries()].map(([id, h]) => [
          id,
          {
            name: h.name,
            bins: Object.fromEntries(
              Object.entries(h.bins).sort(([a], [b]) => Number(a) - Number(b)),
            ),
          },
        ]),
      ),
      unattested: [...unattested.values()]
        .sort((x, y) => y.battles - x.battles || y.decks - x.decks)
        .slice(0, 30),
    };
  } finally {
    await db.end();
  }
}
