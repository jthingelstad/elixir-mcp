/** cards_catalog — the global catalog, served on the recorded-data scale
 *  (feedback #24: maxLevel came through on the API's rarity-relative
 *  scale while every other recorded-data tool serves 1-16, so a catalog
 *  join produced "level 15 of max 6"). 1.0.0: ids / query filters and
 *  verbosity, because a 35 KB static payload was being read to look up
 *  one card id (review 4.3). The same catalog is an MCP resource. */

import {
  responseMeta,
  cardForms,
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

/** One catalog item as served: in-game max level, the API's rarity-scale
 *  value kept under an unambiguous name, and forms decoded. */
function shapeCatalogCard(c) {
  const { maxLevel, ...rest } = c;
  return {
    ...rest,
    maxLevel: MAX_DISPLAY_LEVEL,
    ...(typeof maxLevel === "number" ? { maxLevelRarityScale: maxLevel } : {}),
    forms_available: cardForms(c.maxEvolutionLevel),
  };
}

const compactCard = (c) => ({
  id: c.id,
  name: c.name,
  ...(c.rarity ? { rarity: c.rarity } : {}),
  ...(c.elixirCost !== undefined ? { elixirCost: c.elixirCost } : {}),
  forms_available: c.forms_available,
});

/** The latest recorded catalog, shaped. Shared with the resources door. */
export async function readCatalog(db) {
  const { rows } = await db.query(
    `select payload_json->'items' as items, payload_json->'supportItems' as support_items, last_fetched_at
     from api_payload where endpoint = 'cards' and entity_key = 'GLOBAL'
     order by last_fetched_at desc limit 1`,
  );
  const row = rows[0];
  if (!row) return null;
  return {
    cards: (row.items ?? []).map(shapeCatalogCard),
    tower_troops: (row.support_items ?? []).map(shapeCatalogCard),
    as_of: row.last_fetched_at.toISOString(),
  };
}

export const cardsTools = {
  cards_catalog: {
    description:
      "Current card and tower-troop catalog: ids, names, rarities, elixir cost, icons, max levels and forms. Use it to resolve card ids instead of guessing; ids or query narrow it to the cards you mean, and verbosity compact keeps id, name, rarity, cost and forms. maxLevel is the in-game 1-16 scale like every recorded-data tool; maxLevelRarityScale is the API's rarity-relative cap for anyone joining to raw live_fetch payloads.",
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
        notes: notes(
          "maxLevel is the in-game 1-16 scale (a level-16 card is maxed whatever its rarity); maxLevelRarityScale is the API's per-rarity cap.",
          "forms_available decodes maxEvolutionLevel, a bit field (1 = Evolution, 2 = Hero), never a level.",
        ),
        docs: docsRef("battles", "deck-identity-and-forms"),
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },
  ...synergyTools,
};
