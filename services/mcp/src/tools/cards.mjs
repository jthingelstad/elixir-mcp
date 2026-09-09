/** cards_catalog — the global catalog, served on the recorded-data scale
 *  (feedback #24: maxLevel came through on the API's rarity-relative
 *  scale while every other recorded-data tool serves 1-16, so a catalog
 *  join produced "level 15 of max 6"). */

import {
  responseMeta,
  cardForms,
  MAX_DISPLAY_LEVEL,
} from "@elixir-mcp/contracts";
import { ToolFailure } from "./shared.mjs";
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

export const cardsTools = {
  cards_catalog: {
    description:
      "Current card and tower-troop catalog: ids, names, rarities, elixir cost, icons, max levels and alternate forms. Use it to resolve card ids instead of guessing. maxLevel is on the IN-GAME 1-16 scale (16 for every card) like every recorded-data tool; the API's rarity-relative cap (common 16, rare 14, epic 11, legendary 8, champion 6) rides alongside as maxLevelRarityScale for anyone joining to raw live_fetch payloads. maxEvolutionLevel is a form bit field (1 = Evolution, 2 = Hero, 3 = both), decoded in forms_available.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async handler(ctx) {
      const { rows } = await ctx.db.query(
        `select payload_json->'items' as items, payload_json->'supportItems' as support_items, last_fetched_at
         from api_payload where endpoint = 'cards' and entity_key = 'GLOBAL'
         order by last_fetched_at desc limit 1`,
      );
      const row = rows[0];
      if (!row)
        throw new ToolFailure("not_recorded", "Card catalog not recorded yet.");
      return {
        cards: (row.items ?? []).map(shapeCatalogCard),
        tower_troops: (row.support_items ?? []).map(shapeCatalogCard),
        as_of: row.last_fetched_at.toISOString(),
        scale_note:
          "maxLevel is the in-game 1-16 scale, matching players_collection and battle decks; maxLevelRarityScale is the API's per-rarity cap. A collection card at level 16 is maxed whatever its rarity.",
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },
  ...synergyTools,
};
