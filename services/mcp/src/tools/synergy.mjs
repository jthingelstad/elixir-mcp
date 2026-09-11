/** cards_synergy — the card-pair axis (feedback #19): "what is Witch
 *  played with" needed co-occurrence, per-pair distinct players and lift,
 *  none of which the per-card or per-deck meta could give. */

import {
  responseMeta,
  MODE_GROUPS,
  typesForModeGroup,
  cardForms,
} from "@elixir-mcp/contracts";
import {
  ToolFailure,
  MODE_SCHEMA,
  WINDOW_ARGS,
  SEGMENT_SCHEMA,
  SEGMENT_DOCS,
  requireEnum,
  resolveWindow,
  segmentFilter,
  appliedBlock,
  notes,
  META_METHODOLOGY,
} from "./shared.mjs";
import { catalogItems } from "./cards.mjs";

/** Resolve a card by id or by EXACT name (case-insensitive) against the
 *  recorded catalog. A name that only matches as a substring is refused
 *  with the candidates: Witch and Mother Witch are one fuzzy match apart. */
async function resolveCard(db, { card_id, card }) {
  const items = (await catalogItems(db))
    .filter((r) => r.kind === "card")
    .map((r) => r.item);
  if (card_id !== undefined) {
    const id = Number(card_id);
    const hit = items.find((c) => c.id === id);
    if (!hit)
      throw new ToolFailure(
        "not_found",
        `No card with id ${card_id} in the catalog.`,
        "cards_catalog lists every id.",
      );
    return hit;
  }
  const name = String(card ?? "")
    .trim()
    .toLowerCase();
  if (!name) throw new ToolFailure("bad_request", "Give card_id or card.");
  const exact = items.filter((c) => c.name.toLowerCase() === name);
  if (exact.length === 1) return exact[0];
  const near = items.filter((c) => c.name.toLowerCase().includes(name));
  throw new ToolFailure(
    near.length ? "bad_request" : "not_found",
    near.length
      ? `'${card}' is not an exact card name. Candidates: ${near.map((c) => `${c.name} (${c.id})`).join(", ")}.`
      : `No card named '${card}'.`,
    "Names resolve only on an exact match so Witch is never read as Mother Witch; pass card_id to be unambiguous.",
  );
}

export const synergyTools = {
  cards_synergy: {
    description:
      "What a card is played WITH, for a segment (the corpus by default) and window (default 28 days): partner cards ranked by co-occurrence in decided head-to-head decks that contain the anchor, with co_occurrence_rate, distinct players per pair, the partner's baseline usage and lift = co_occurrence_rate / baseline (near 1 = rides along with everything). Anchor by card_id or exact name, never fuzzy; forms merge for the anchor by default while partners stay split by form.",
    inputSchema: {
      type: "object",
      properties: {
        card_id: {
          type: "integer",
          description: "Anchor card id (preferred).",
        },
        card: {
          type: "string",
          description:
            "Anchor card by EXACT name (case-insensitive); ambiguous names are refused with candidates.",
        },
        segment: SEGMENT_SCHEMA,
        ...WINDOW_ARGS,
        mode: MODE_SCHEMA,
        merge_forms: {
          type: "boolean",
          default: true,
          description:
            "Treat the anchor's base, Evolution and Hero forms as one card (default); false anchors on one form, chosen with anchor_form.",
        },
        anchor_form: {
          type: "string",
          enum: ["base", "evolution", "hero"],
          description: "With merge_forms false: which form of the anchor.",
        },
        min_pair_battles: {
          type: "integer",
          minimum: 1,
          default: 5,
          description: "Decided decks a pair needs to be listed.",
        },
        limit: { type: "integer", minimum: 1, maximum: 60, default: 20 },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const anchor = await resolveCard(ctx.db, args);
      const params = [];
      const seg = await segmentFilter(ctx, args, params);
      const win = resolveWindow(ctx, args, { defaultDays: 28 });
      const where = [
        "bp.deck ? 'cards'",
        "jsonb_array_length(bp.deck->'cards') > 0",
        "bp.outcome in ('win','loss')",
        "b.type_class = 'pvp'",
      ];
      if (seg.where) where.push(seg.where);
      params.push(win.from);
      where.push(`b.battle_time >= $${params.length}`);
      if (win.to) {
        params.push(win.to);
        where.push(`b.battle_time < $${params.length}`);
      }
      requireEnum(args.mode, MODE_GROUPS, "mode");
      if (args.mode) {
        params.push(typesForModeGroup(args.mode));
        where.push(`b.type = any($${params.length})`);
      }
      const merge = args.merge_forms !== false;
      const formBit = { base: 0, evolution: 1, hero: 2 }[
        args.anchor_form ?? "base"
      ];
      if (formBit === undefined)
        throw new ToolFailure(
          "bad_request",
          "anchor_form must be base, evolution or hero.",
        );
      params.push(anchor.id);
      const anchorId = `$${params.length}`;
      let anchorForm = null;
      if (!merge) {
        params.push(formBit);
        anchorForm = `$${params.length}`;
      }
      const anchorMatch = merge
        ? `exists (select 1 from jsonb_array_elements(bp.deck->'cards') a
                   where (a.value->>'id')::bigint = ${anchorId})`
        : `exists (select 1 from jsonb_array_elements(bp.deck->'cards') a
                   where (a.value->>'id')::bigint = ${anchorId}
                     and coalesce((a.value->>'evolutionLevel')::int, 0) = ${anchorForm})`;
      const minPair = Math.max(1, Number(args.min_pair_battles ?? 5));
      const limit = Math.min(Math.max(Number(args.limit ?? 20), 1), 60);
      const { rows } = await ctx.db.query(
        `with pop as (
           select bp.player_tag, bp.outcome, bp.deck, (${anchorMatch}) as has_anchor
           from battle_participant bp join battle b on b.battle_id = bp.battle_id
           where ${where.join(" and ")}),
         totals as (
           select count(*)::int as decided,
                  count(*) filter (where has_anchor)::int as anchor_decks,
                  count(distinct player_tag) filter (where has_anchor)::int as anchor_players,
                  count(*) filter (where has_anchor and outcome = 'win')::int as anchor_wins
           from pop),
         baseline as (
           select (c.value->>'id')::bigint as card_id,
                  coalesce((c.value->>'evolutionLevel')::int, 0) as form,
                  count(*)::int as battles
           from pop cross join lateral jsonb_array_elements(pop.deck->'cards') c
           group by 1, 2),
         pairs as (
           select (c.value->>'id')::bigint as card_id, c.value->>'name' as name,
                  coalesce((c.value->>'evolutionLevel')::int, 0) as form,
                  count(*)::int as co_battles,
                  count(distinct pop.player_tag)::int as players,
                  count(*) filter (where pop.outcome = 'win')::int as wins
           from pop cross join lateral jsonb_array_elements(pop.deck->'cards') c
           where pop.has_anchor and (c.value->>'id')::bigint <> ${anchorId}
           group by 1, 2, 3)
         select p.*, bl.battles as baseline_battles,
                t.decided, t.anchor_decks, t.anchor_players, t.anchor_wins
         from pairs p
         join baseline bl on bl.card_id = p.card_id and bl.form = p.form
         cross join totals t
         where p.co_battles >= ${minPair}
         order by p.co_battles desc, p.players desc
         limit ${limit}`,
        params,
      );
      const t = rows[0] ?? {};
      let totals = t;
      if (!rows[0]) {
        const { rows: tr } = await ctx.db.query(
          `select count(*)::int as decided,
                  count(*) filter (where ${anchorMatch})::int as anchor_decks,
                  count(distinct bp.player_tag) filter (where ${anchorMatch})::int as anchor_players,
                  count(*) filter (where ${anchorMatch} and bp.outcome = 'win')::int as anchor_wins
           from battle_participant bp join battle b on b.battle_id = bp.battle_id
           where ${where.join(" and ")}`,
          params,
        );
        totals = tr[0];
      }
      const decided = totals.decided ?? 0;
      const anchorDecks = totals.anchor_decks ?? 0;
      return {
        anchor: {
          card_id: anchor.id,
          name: anchor.name,
          forms_available: cardForms(anchor.maxEvolutionLevel),
          forms_merged: merge,
          ...(merge ? {} : { form: args.anchor_form ?? "base" }),
          decks: anchorDecks,
          players: totals.anchor_players ?? 0,
          win_rate:
            anchorDecks > 0
              ? Number(((totals.anchor_wins ?? 0) / anchorDecks).toFixed(3))
              : null,
          usage_share:
            decided > 0 ? Number((anchorDecks / decided).toFixed(3)) : null,
        },
        applied: appliedBlock({
          segment: seg.echo,
          window: win.echo,
          mode: args.mode,
          merge_forms: merge,
          anchor_form: merge ? undefined : (args.anchor_form ?? "base"),
          min_pair_battles: minPair,
          limit,
        }),
        decided_battles: decided,
        ...(anchorDecks < META_METHODOLOGY.segment_min_decided
          ? {
              insufficient_sample: true,
              insufficient_sample_floor: META_METHODOLOGY.segment_min_decided,
            }
          : {}),
        partners: rows.map((r) => {
          const rate = anchorDecks > 0 ? r.co_battles / anchorDecks : null;
          const base = decided > 0 ? r.baseline_battles / decided : null;
          return {
            card_id: Number(r.card_id),
            name: r.name,
            ...(r.form > 0
              ? { evolution: r.form, form: r.form === 1 ? "evolution" : "hero" }
              : {}),
            co_battles: r.co_battles,
            players: r.players,
            co_occurrence_rate: rate === null ? null : Number(rate.toFixed(3)),
            baseline_usage: base === null ? null : Number(base.toFixed(3)),
            lift:
              rate !== null && base ? Number((rate / base).toFixed(2)) : null,
            win_rate_with_anchor:
              r.co_battles > 0
                ? Number((r.wins / r.co_battles).toFixed(3))
                : null,
          };
        }),
        notes: notes(
          "co_occurrence_rate = decks with anchor AND partner / decks with anchor; baseline_usage = the partner's share of all decided decks in the segment; lift = co_occurrence_rate / baseline_usage.",
          "players is distinct pilots for the pair and is what tells a personal habit from a pattern; win_rate_with_anchor describes who plays the pair, not the pair.",
          "Decided head-to-head player-battle observations only (duels, boat battles, draws excluded; both sides of a match can contribute); partners keep forms as separate rows.",
        ),
        docs: SEGMENT_DOCS,
        meta: responseMeta({
          as_of: new Date().toISOString(),
          ...(win.timezone ? { timezone_applied: win.timezone } : {}),
        }),
      };
    },
  },
};
