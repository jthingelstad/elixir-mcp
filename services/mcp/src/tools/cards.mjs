/** cards_catalog — moved verbatim from the
 *  single-file registry (review item 8). */

import { responseMeta } from "@elixir-mcp/contracts";
import { ToolFailure } from "./shared.mjs";

export const cardsTools = {
  cards_catalog: {
    description:
      "Current card and tower-troop catalog: ids, names, rarities, max levels, evolution availability. Use it to resolve card ids instead of guessing.",
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
        cards: row.items,
        tower_troops: row.support_items,
        as_of: row.last_fetched_at.toISOString(),
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },
};
