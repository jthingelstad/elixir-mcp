/** cards_catalog — the global catalog, served on the recorded-data scale
 *  (feedback #24: maxLevel came through on the API's rarity-relative
 *  scale while every other recorded-data tool serves 1-16, so a catalog
 *  join produced "level 15 of max 6"). 1.0.0: ids / query filters and
 *  verbosity, because a 35 KB static payload was being read to look up
 *  one card id (review 4.3). The same catalog is an MCP resource. */

import {
  responseMeta,
  cardForms,
  cardType,
  MAX_DISPLAY_LEVEL,
} from "@elixir-mcp/contracts";
import {
  ToolFailure,
  VERBOSITY,
  appliedBlock,
  notes,
  docsRef,
} from "./shared.mjs";
import { synergyTools } from "./synergy.mjs";
import { cardProfileTools } from "./card-profile.mjs";
import { archetypeTools } from "./archetype.mjs";

/** One catalog item as served: in-game max level, the API's rarity-scale
 *  value kept under an unambiguous name, and forms decoded. */
function shapeCatalogCard(c) {
  const { maxLevel, ...rest } = c;
  return {
    ...rest,
    type: cardType(c.id),
    maxLevel: MAX_DISPLAY_LEVEL,
    ...(typeof maxLevel === "number" ? { maxLevelRarityScale: maxLevel } : {}),
    forms_available: cardForms(c.maxEvolutionLevel),
  };
}

const compactCard = (c) => ({
  id: c.id,
  name: c.name,
  type: c.type,
  ...(c.rarity ? { rarity: c.rarity } : {}),
  ...(c.elixirCost !== undefined ? { elixirCost: c.elixirCost } : {}),
  forms_available: c.forms_available,
});

/** The catalog rows in the API's own item shape (0076: the `card`
 *  table, never the payload cache), oldest id first. Shared by
 *  cards_catalog, cards_synergy's name resolution and the collector
 *  card avatars. */
/** The API's iconUrls object from the three columns (0123): the keys
 *  it carried, none it did not. */
function iconUrlsOf(r) {
  const out = {};
  if (r.icon_medium) out.medium = r.icon_medium;
  if (r.icon_evolution_medium) out.evolutionMedium = r.icon_evolution_medium;
  if (r.icon_hero_medium) out.heroMedium = r.icon_hero_medium;
  return Object.keys(out).length > 0 ? out : null;
}

export async function catalogItems(db) {
  const { rows } = await db.query(
    `select card_id, name, kind, rarity, elixir_cost, max_level, max_evolution_level,
            icon_medium, icon_evolution_medium, icon_hero_medium, observed_at,
            catalog_seen_at
     from card order by card_id`,
  );
  return rows.map((r) => ({
    kind: r.kind,
    observed_at: r.observed_at,
    catalog_seen_at: r.catalog_seen_at,
    item: {
      id: r.card_id,
      name: r.name,
      ...(r.max_level !== null ? { maxLevel: r.max_level } : {}),
      ...(r.max_evolution_level !== null
        ? { maxEvolutionLevel: r.max_evolution_level }
        : {}),
      ...(r.elixir_cost !== null ? { elixirCost: r.elixir_cost } : {}),
      ...(iconUrlsOf(r) ? { iconUrls: iconUrlsOf(r) } : {}),
      ...(r.rarity ? { rarity: r.rarity } : {}),
    },
  }));
}

/** The recorded catalog, shaped. Shared with the resources door. */
export async function readCatalog(db) {
  const rows = await catalogItems(db);
  if (rows.length === 0) return null;
  const asOf = rows.reduce(
    (m, r) => (r.observed_at > m ? r.observed_at : m),
    rows[0].observed_at,
  );
  // as_of is the catalog's last CHANGE (ingest moves observed_at only
  // when a card's fields differ); fetched_at is the last confirming
  // fetch, so a reader can tell "unchanged since" from "stale" (5.0.0).
  // The confirming instant is the GLOBAL cards poll's own admission
  // stamp: catalog_seen_at moves only when a row moves (a re-fetch
  // writes nothing, by design), so reading it here said the catalog
  // had not been confirmed since its last change (2026-09-19: nine
  // days "stale" while every daily fetch had landed). The row stamp is
  // the fallback for a database without poll_state (tests).
  const {
    rows: [poll],
  } = await db.query(
    `select last_admitted_at from poll_state
     where subject_tag = 'GLOBAL' and endpoint = 'cards'`,
  );
  const fetched = rows.reduce(
    (m, r) =>
      r.catalog_seen_at && (!m || r.catalog_seen_at > m)
        ? r.catalog_seen_at
        : m,
    poll?.last_admitted_at ?? null,
  );
  return {
    cards: rows
      .filter((r) => r.kind === "card")
      .map((r) => shapeCatalogCard(r.item)),
    tower_troops: rows
      .filter((r) => r.kind === "support")
      .map((r) => shapeCatalogCard(r.item)),
    as_of: asOf.toISOString(),
    fetched_at: fetched ? fetched.toISOString() : null,
  };
}

export const cardsTools = {
  cards_catalog: {
    description:
      "Current card and tower-troop catalog: ids, names, types, rarities, elixir cost, icons, max levels and forms. Use it to resolve card ids instead of guessing; ids or query narrow it to the cards you mean, and verbosity compact keeps id, name, rarity, cost and forms. maxLevel is the in-game 1-16 scale like every recorded-data tool; maxLevelRarityScale is the API's rarity-relative cap for anyone joining to raw live_fetch payloads.",
    inputSchema: {
      type: "object",
      properties: {
        ids: {
          type: "array",
          items: { type: "integer" },
          minItems: 1,
          maxItems: 50,
          description: "Only these card ids.",
        },
        query: {
          type: "string",
          minLength: 1,
          maxLength: 40,
          description: "Case-insensitive substring of a card name.",
        },
        verbosity: VERBOSITY(
          "id, name, rarity, elixirCost and forms_available per card; no icons, levels or counts.",
        ),
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const catalog = await readCatalog(ctx.db);
      if (!catalog)
        throw new ToolFailure("not_recorded", "Card catalog not recorded yet.");
      const ids = Array.isArray(args.ids)
        ? new Set(args.ids.map(Number))
        : null;
      const q = args.query ? String(args.query).trim().toLowerCase() : null;
      const keep = (c) =>
        (!ids || ids.has(c.id)) &&
        (!q ||
          String(c.name ?? "")
            .toLowerCase()
            .includes(q));
      const compact = args.verbosity === "compact";
      const shape = compact ? compactCard : (c) => c;
      return {
        applied: appliedBlock({
          ids: ids ? [...ids] : undefined,
          query: q ?? undefined,
          verbosity: compact ? "compact" : "full",
        }),
        cards: catalog.cards.filter(keep).map(shape),
        tower_troops: catalog.tower_troops.filter(keep).map(shape),
        as_of: catalog.as_of,
        fetched_at: catalog.fetched_at,
        notes: notes(
          "as_of is when the catalog last CHANGED (a card added, renamed, recosted or given a form); fetched_at is the last daily fetch that confirmed it.",
          "maxLevel is the in-game 1-16 scale (a level-16 card is maxed whatever its rarity); maxLevelRarityScale is the API's per-rarity cap.",
          "forms_available decodes maxEvolutionLevel, a bit field (1 = Evolution, 2 = Hero), never a level; type comes from the card id's range (troop, building, spell, tower_troop), which the API does not spell out.",
        ),
        docs: docsRef("battles", "deck-identity-and-forms"),
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },
  ...synergyTools,
  ...cardProfileTools,
  ...archetypeTools,
};
