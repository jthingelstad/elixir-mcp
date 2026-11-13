import { json } from "../http.mjs";
import {
  DISCLAIMER,
  cardArt,
  cardForms,
  cardType,
} from "@elixir-mcp/contracts";
import { readPublicStats } from "@elixir-mcp/tools/public-stats";
import { readPublicStatus } from "@elixir-mcp/tools/public-status";
import { readPublicBattle } from "../battle-page.mjs";

export function publicRoutes({ deadLetters }) {
  return {
    "GET /api/public/status": async (db) =>
      json(200, await readPublicStatus(db, { deadLetters }), {
        "cache-control": "public, max-age=60",
      }),

    // The card catalog, PUBLIC and sign-in free.
    "GET /api/public/cards": async (db) => {
      const { readCatalog } = await import("@elixir-mcp/tools/cards");
      const catalog = await readCatalog(db);
      if (!catalog) return json(503, { error: "catalog_empty" });
      return json(
        200,
        {
          cards: catalog.cards,
          as_of: catalog.as_of,
          disclaimer: DISCLAIMER,
        },
        { "cache-control": "public, max-age=3600" },
      );
    },

    // One battle, PUBLIC and sign-in free (Jamie, 2026-10-01: "Public
    // yes."): what /battle/<short id> shows, by its full id, its short id
    // or its link. A recorded battle does not change, so the edge keeps
    // it an hour; a miss only a minute, since the battle may yet arrive.
    "GET /api/public/battles/*": async (db, event) => {
      const read = await readPublicBattle(db, event.pathParam);
      if (read.status === 404)
        return json(
          404,
          { error: "not_found" },
          { "cache-control": "public, max-age=60" },
        );
      if (read.status === 300)
        return json(
          300,
          { error: "ambiguous", matches: read.matches },
          { "cache-control": "public, max-age=60" },
        );
      const body = { ...read };
      delete body.status;
      return json(200, body, { "cache-control": "public, max-age=3600" });
    },

    "GET /api/public/cards/*": async (db, event) => {
      const cardId = Number(event.pathParam);
      if (!Number.isInteger(cardId)) return json(404, { error: "not_found" });
      const {
        rows: [card],
      } = await db.query(
        `select card_id, name, kind, rarity, elixir_cost, max_evolution_level,
                icon_medium, icon_evolution_medium, icon_hero_medium
           from card where card_id = $1 and kind = 'card'`,
        [cardId],
      );
      if (!card) return json(404, { error: "not_found" });
      return json(
        200,
        {
          card: {
            id: card.card_id,
            name: card.name,
            rarity: card.rarity,
            elixir_cost: card.elixir_cost,
            forms_available: cardForms(card.max_evolution_level),
            type: cardType(card.card_id),
            // Each form's art on Elixir's own origin, from the API's
            // iconUrls (11.5.0; contracts card-art.ts).
            art: cardArt(card.card_id, {
              medium: card.icon_medium,
              evolutionMedium: card.icon_evolution_medium,
              heroMedium: card.icon_hero_medium,
            }),
          },
          disclaimer: DISCLAIMER,
        },
        { "cache-control": "public, max-age=900" },
      );
    },

    "GET /api/public/stats": async (db) => {
      // The public data story (2026-09-05): corpus scale and
      // full-history daily series. No auth, no account data - the
      // universal-reads boundary applied to aggregates. CloudFront
      // caches it for an hour.
      return json(200, await readPublicStats(db), {
        "cache-control": "public, max-age=3600",
      });
    },
  };
}
