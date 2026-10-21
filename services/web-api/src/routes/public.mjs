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

    "GET /api/public/efficiency": async (db) => {
      // The session clock's cost and loss, per day (0145; Jamie,
      // 2026-09-19: the breakage belongs on the collector pages).
      // PUBLIC like the status page: aggregates only, no player named.
      // The closed days come from the nightly table; the current UTC
      // day is read live from the receipts (polls, what they found,
      // gaps) - its loss cannot be known until its snapshot intervals
      // close, so it carries lost_battles: null.
      const q = async (sql, params = []) => (await db.query(sql, params)).rows;
      const days = await q(
        `select day::text, computed_at, battlelog_polls, productive_polls,
                nothing_new_polls, battles_captured, audited_polls, gaps,
                intervals, gap_intervals, expected_gap, captured_gap,
                shortfall_gap, expected_no_gap, shortfall_no_gap, noise_rate,
                lost_battles, players_with_gaps
           from capture_efficiency_daily
          where day >= (now() at time zone 'UTC')::date - 28
          order by day`,
      );
      const [today] = await q(
        `select (now() at time zone 'UTC')::date::text as day,
                count(*)::int as battlelog_polls,
                count(*) filter (where r.new_facts > 0)::int as productive_polls,
                count(*) filter (where r.observed is not null and r.observed = r.filtered)::int as nothing_new_polls,
                coalesce(sum(r.new_facts), 0)::int as battles_captured,
                count(ca.receipt_id)::int as audited_polls,
                count(ca.receipt_id) filter (where ca.gap)::int as gaps
           from api_receipt r
           join gateway g on g.gateway_id = r.gateway_id
           left join capture_audit ca on ca.receipt_id = r.receipt_id
          where g.name <> 'backfill-elixir-bot'
            and r.endpoint = 'player_battlelog' and r.admission = 'admitted'
            and r.fetched_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'`,
      );
      const [hour] = await q(
        `select count(*)::int as battlelog_polls,
                count(*) filter (where r.observed is not null and r.observed = r.filtered)::int as nothing_new_polls,
                count(ca.receipt_id) filter (where ca.gap)::int as gaps
           from api_receipt r
           join gateway g on g.gateway_id = r.gateway_id
           left join capture_audit ca on ca.receipt_id = r.receipt_id
          where g.name <> 'backfill-elixir-bot'
            and r.endpoint = 'player_battlelog' and r.admission = 'admitted'
            and r.fetched_at > now() - interval '1 hour'`,
      );
      return json(
        200,
        {
          as_of: new Date().toISOString(),
          rule: {
            followup_minutes: 30,
            ceiling_minutes: 120,
            profile_daily: true,
            since: "2026-09-19",
          },
          days: days.map((d) => ({
            ...d,
            noise_rate: d.noise_rate === null ? null : Number(d.noise_rate),
            computed_at: d.computed_at?.toISOString?.() ?? d.computed_at,
          })),
          today: { ...today, lost_battles: null },
          last_hour: hour,
          note: "Battles lost are measured nightly against the game's own lifetime battle counter over profile snapshot intervals; intervals without a capture gap set the noise floor (modes the battle log never shows). The current day's loss is known the morning after.",
        },
        { "cache-control": "public, max-age=300" },
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
