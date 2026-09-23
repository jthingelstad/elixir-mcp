/** cards_synergy — the card-pair axis (feedback #19): "what is Witch
 *  played with" needed co-occurrence, per-pair distinct players and lift,
 *  none of which the per-card or per-deck meta could give. */

import {
  responseMeta,
  MODE_GROUPS,
  modeGroupSql,
  typesForModeGroup,
  cardForms,
  formName,
} from "@elixir-mcp/contracts";
import {
  META_EVENT_NOTE,
  metaPopulationClause,
  participantModeClause,
} from "../mode-filter.mjs";
import {
  ToolFailure,
  MODE_SCHEMA,
  WINDOW_ARGS,
  SEGMENT_SCHEMA,
  SEGMENT_DOCS,
  requireEnum,
  resolveSeasonWindow,
  SEASON_ARG_SCHEMA,
  segmentFilter,
  appliedBlock,
  notes,
  META_METHODOLOGY,
  populationBlock,
} from "./shared.mjs";
import {
  seasonRollup,
  rollupSynergy,
  rawScanMemory,
  rollupCardModes,
  TROPHY_BAND_NAMES,
  trophyBandClause,
  RANKED_NO_BAND_NOTE,
} from "../meta-season.mjs";
import { modeSplit } from "../controls.mjs";
import { catalogItems } from "./cards.mjs";

/** Resolve a card by id or by EXACT name (case-insensitive) against the
 *  recorded catalog. A name that only matches as a substring is refused
 *  with the candidates: Witch and Mother Witch are one fuzzy match apart. */
export async function resolveCard(db, { card_id, card }) {
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

const RAW_MODE_GROUP = modeGroupSql("bp.type", "null::text");

export const synergyTools = {
  cards_synergy: {
    description:
      "What a card is played WITH, for a named population (segment 'mine', 'corpus' or {clan_tag | player_tag | collection}) and window (default: the current season to date; season selects another): partner cards ranked by co-occurrence in decided head-to-head decks that contain the anchor, with co_occurrence_rate, distinct players per pair, the partner's baseline usage and lift = co_occurrence_rate / baseline (near 1 = rides along with everything). Anchor by card_id or exact name, never fuzzy; the anchor's forms merge by default, partners stay split by form.",
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
        season: SEASON_ARG_SCHEMA,
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
        trophy_band: {
          type: "string",
          enum: TROPHY_BAND_NAMES,
          description:
            "Only decks whose own player entered with starting trophies in this band: the anchor's partners at a level. A corpus season read answers from the banded rollup once the nightly rebuild has filled it, else from the raw rows with a note.",
        },
      },
      required: ["segment"],
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const anchor = await resolveCard(ctx.db, args);
      const params = [];
      const seg = await segmentFilter(ctx, args, params);
      const win = await resolveSeasonWindow(ctx, args);
      const where = [
        "bp.deck_hash is not null",
        "bp.outcome in ('win','loss')",
        "bp.type_class = 'pvp'",
      ];
      if (seg.where) where.push(seg.where);
      params.push(win.from);
      where.push(`${seg.timeColumn} >= $${params.length}`);
      if (win.to) {
        params.push(win.to);
        where.push(`${seg.timeColumn} < $${params.length}`);
      }
      requireEnum(args.mode, MODE_GROUPS, "mode");
      if (args.mode) where.push(participantModeClause(args.mode, params));
      // The meta population the season rollup counts (Gym #154).
      where.push(metaPopulationClause());
      requireEnum(args.trophy_band, TROPHY_BAND_NAMES, "trophy_band");
      if (args.trophy_band)
        where.push(trophyBandClause(args.trophy_band, params));
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
      // Identity is per deck (0091): the anchor test and the pair walk read
      // deck_card by deck_hash - eight indexed rows per participant, never
      // a JSON explode.
      const anchorMatch = merge
        ? `bp.deck_hash in (select a.deck_hash from deck_card a where a.card_id = ${anchorId})`
        : `bp.deck_hash in (select a.deck_hash from deck_card a
                            where a.card_id = ${anchorId} and a.form = ${anchorForm})`;

      const minPair = Math.max(1, Number(args.min_pair_battles ?? 5));
      const limit = Math.min(Math.max(Number(args.limit ?? 20), 1), 60);
      // A corpus read over one season comes from the rollup (0121): the
      // anchor's row (form -1 = any form) and its pairs; a segment or an
      // explicit window walks the raw rows as before.
      const rolled = await seasonRollup(ctx.db, {
        win,
        seg,
        mode: args.mode,
        trophyBand: args.trophy_band ?? null,
      });
      const bandPending = rolled?.pending === true;
      const roll = bandPending ? null : rolled;
      let rows;
      let totals;
      // The anchor's decks by mode group (3.16.0): the control beside a
      // co-occurrence read, since war and ladder pool different decks.
      let anchorModes;
      if (roll) {
        const r = await rollupSynergy(ctx.db, roll, {
          anchorId: anchor.id,
          anchorForm: merge ? -1 : formBit,
          minPair,
          limit,
          season: win.season,
          types: args.mode ? typesForModeGroup(args.mode) : null,
        });
        totals = {
          decided: roll.prior.decided,
          window_players: roll.players,
          anchor_decks: r.anchor.battles,
          anchor_players: r.anchor.players,
          anchor_wins: r.anchor.wins,
        };
        rows = r.partners;
        anchorModes = modeSplit(
          (
            await rollupCardModes(ctx.db, roll, [
              { card_id: anchor.id, form: merge ? -1 : formBit },
            ])
          ).get(`${anchor.id}|${merge ? -1 : formBit}`) ?? [],
        );
      } else {
        await rawScanMemory(ctx.db);
        const { rows: byType } = await ctx.db.query(
          // The rollup's own group rule (#154: one odd-typed battle read
          // `other` here and `casual` on the season read). Event battles
          // are outside the meta population, so no tag is needed.
          `select ${RAW_MODE_GROUP} as mode_group, count(*)::int as battles,
                  count(*) filter (where bp.outcome = 'win')::int as wins,
                  count(*) filter (where bp.outcome = 'loss')::int as losses
           from battle_participant bp
           where ${where.join(" and ")} and ${anchorMatch}
           group by 1`,
          params,
        );
        anchorModes = modeSplit(byType);
        rows = (
          await ctx.db.query(
            `with pop as (
           select bp.player_tag, bp.outcome, bp.deck_hash, (${anchorMatch}) as has_anchor
           from battle_participant bp
           where ${where.join(" and ")}),
         totals as (
           select count(*)::int as decided,
                  count(distinct player_tag)::int as window_players,
                  count(*) filter (where has_anchor)::int as anchor_decks,
                  count(distinct player_tag) filter (where has_anchor)::int as anchor_players,
                  count(*) filter (where has_anchor and outcome = 'win')::int as anchor_wins
           from pop),
         baseline as (
           select dc.card_id, dc.form, count(*)::int as battles
           from pop join deck_card dc on dc.deck_hash = pop.deck_hash
           group by 1, 2),
         pairs as (
           select dc.card_id, c.name, dc.form,
                  count(*)::int as co_battles,
                  count(distinct pop.player_tag)::int as players,
                  count(*) filter (where pop.outcome = 'win')::int as wins
           from pop
           join deck_card dc on dc.deck_hash = pop.deck_hash
           join card c on c.card_id = dc.card_id
           where pop.has_anchor and dc.card_id <> ${anchorId}
           group by 1, 2, 3)
         select p.*, bl.battles as baseline_battles,
                t.decided, t.window_players, t.anchor_decks, t.anchor_players, t.anchor_wins
         from pairs p
         join baseline bl on bl.card_id = p.card_id and bl.form = p.form
         cross join totals t
         where p.co_battles >= ${minPair}
         order by p.co_battles desc, p.players desc
         limit ${limit}`,
            params,
          )
        ).rows;
        totals = rows[0] ?? {};
        if (!rows[0]) {
          const { rows: tr } = await ctx.db.query(
            `select count(*)::int as decided,
                    count(distinct bp.player_tag)::int as window_players,
                    count(*) filter (where ${anchorMatch})::int as anchor_decks,
                    count(distinct bp.player_tag) filter (where ${anchorMatch})::int as anchor_players,
                    count(*) filter (where ${anchorMatch} and bp.outcome = 'win')::int as anchor_wins
             from battle_participant bp
             where ${where.join(" and ")}`,
            params,
          );
          totals = tr[0];
        }
      }
      const decided = totals.decided ?? 0;
      const anchorDecks = totals.anchor_decks ?? 0;
      const population = seg.where
        ? null
        : await populationBlock(ctx.db, {
            playersInWindow: totals.window_players ?? null,
          });
      return {
        ...(population ? { population } : {}),
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
          modes: anchorModes,
        },
        applied: appliedBlock({
          segment: seg.echo,
          window: win.echo,
          mode: args.mode,
          trophy_band: args.trophy_band,
          merge_forms: merge,
          anchor_form: merge ? undefined : (args.anchor_form ?? "base"),
          min_pair_battles: minPair,
          limit,
        }),
        decided_battles: decided,
        ...(roll ? { players_as_of: roll.players_as_of } : {}),
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
            form: formName(r.form),
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
          args.mode === "event" ? META_EVENT_NOTE : null,
          bandPending
            ? "trophy_band answered from the raw rows (the season's banded rollup is not built yet; the nightly rebuild fills it)."
            : null,
          !args.mode && Object.keys(anchorModes ?? {}).length > 1
            ? "anchor.modes splits the anchor's decks by mode group: war and ladder pool different decks, so pass mode before reading a partner as a ladder habit."
            : null,
          "co_occurrence_rate = decks with anchor AND partner / decks with anchor; baseline_usage = the partner's share of all decided decks in the segment; lift = co_occurrence_rate / baseline_usage.",
          "players is distinct pilots for the pair and is what tells a personal habit from a pattern; win_rate_with_anchor describes who plays the pair, not the pair.",
          "Decided head-to-head player-battle observations only (duels, boat battles, draws excluded; both sides of a match can contribute); partners keep forms as separate rows.",
          args.trophy_band && args.mode !== "ladder"
            ? RANKED_NO_BAND_NOTE
            : null,
          "anchor.decks counts decided player-battle observations with the anchor, not distinct deck identities (cards_archetype and battles_meta_decks count identities as decks); it is the denominator co_occurrence_rate divides by.",
          win.seasonNotes,
          roll?.note,
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
