import { json } from "../http.mjs";
import {
  DISCLAIMER,
  badgeArt,
  cardArt,
  cardForms,
  cardType,
} from "@elixir-mcp/contracts";
import { readPublicStats } from "@elixir-mcp/tools/public-stats";
import { readPublicStatus } from "@elixir-mcp/tools/public-status";

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

    // The game's badge art, PUBLIC and sign-in free (2026-11-17, the
    // owner: "Yes use badge art. For sure."): each badge and level a
    // read profile has carried, its icon URL and the mirrored copy on
    // this origin. Reference only: no player, no count of holders. The
    // deploy's mirror reads this list (infra/scripts/mirror-card-art.mjs).
    "GET /api/public/badges": async (db) => {
      const { rows } = await db.query(
        `select name, level, icon_url from badge_art order by name, level`,
      );
      return json(
        200,
        {
          badges: rows.map((r) => ({
            name: r.name,
            level: r.level,
            icon_url: r.icon_url,
            art: badgeArt(r.icon_url),
          })),
          disclaimer: DISCLAIMER,
        },
        { "cache-control": "public, max-age=3600" },
      );
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
