/** battles_query · battles_performance · battles_cards · battles_decks ·
 *  battles_meta_decks · battles_meta_cards · battles_trends ·
 *  battles_levels · battles_compare. Conventions (1.0.0, shared.mjs):
 *  from/to + timezone on every windowed tool, one `applied` echo,
 *  `notes[]` + `docs`, `verbosity` as the size control, nested `segment`
 *  on the corpus-wide tools. */

import {
  normalizeTag,
  responseMeta,
  MODE_GROUPS,
  typesForModeGroup,
} from "@elixir-mcp/contracts";
import { formatLocal } from "../time.mjs";
import {
  requireEnum,
  ToolFailure,
  TAG_SCHEMA,
  ON_BEHALF_OF_SCHEMA,
  MODE_SCHEMA,
  WINDOW_ARGS,
  WINDOW_FROM_DESC,
  WINDOW_TO_DESC,
  VERBOSITY,
  SEGMENT_SCHEMA,
  SEGMENT_NOTES,
  SEGMENT_DOCS,
  subject,
  buildMeta,
  resolveWindow,
  requireOrderedWindow,
  appliedBlock,
  notes,
  docsRef,
  spendLiveQuota,
  segmentFilter,
  ebShrink,
  META_METHODOLOGY,
  DUEL_TYPES,
  excludedBreakdown,
  corpusPrior,
} from "./shared.mjs";
import { resolveInstant } from "../time.mjs";

/** tower_hp as served: a one-tower princess array is padded to fixed
 *  length 2 with 0 for the destroyed tower (feedback #22: the API omits a
 *  destroyed tower on head-to-head rows and writes 0 on duel rows, so
 *  array length was not a tower count). Position carries no meaning. */
function normalizeTowerHp(t) {
  if (!t || typeof t !== "object") return t ?? null;
  if (Array.isArray(t.princess) && t.princess.length === 1)
    return { ...t, princess: [t.princess[0], 0] };
  return t;
}

const FORM_ROWS_NOTE =
  "Forms are separate rows: evolution marks card FORM (1 = Evolution, 2 = Hero), never a level, so a card played in two forms carries two records.";

const roundsPlayed = (deck) =>
  Array.isArray(deck?.rounds) ? { rounds_played: deck.rounds.length } : {};

/**
 * Deck cards as deck_hash sees them. evolutionLevel is part of deck
 * IDENTITY (packages/contracts/src/deck.ts: "form discriminators are part
 * of identity"; 1 = Evolution, 2 = Hero, never a level), as is the tower
 * troop. Rendering {id, name} alone meant two decks with visually
 * identical cards could carry different deck_hash values with nothing in
 * the payload explaining the split (playtest round, 2026-09-09).
 */
const deckCards = (deck) =>
  (deck?.cards ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    ...(c.evolutionLevel > 0 ? { evolution: c.evolutionLevel } : {}),
  }));

/** The other half of deck identity, absent for battles predating tower troops. */
const towerTroop = (deck) => {
  const t = deck?.supportCards?.[0];
  return t?.id === undefined ? {} : { tower_troop: { id: t.id, name: t.name } };
};

const BATTLE_DOCS = docsRef("battles", "what-a-battle-record-holds");
const DENOMINATOR_DOCS = docsRef("battles", "decided-battles-and-denominators");

import {
  LEVEL_EDGES_SQL,
  levelPairsSql,
  PILOT_METHODOLOGY,
  PILOT_NOTES,
  PILOT_DOCS,
  medianSortedScores,
} from "../level-curve.mjs";

/** Shared: the mode filter as a WHERE clause on battle.type. */
function modeClause(args, add) {
  requireEnum(args.mode, MODE_GROUPS, "mode");
  if (args.mode) add("b.type = any(?)", typesForModeGroup(args.mode));
}

export const battlesTools = {
  battles_query: {
    description:
      "The workhorse: recorded battles with filters and cursor pagination, both perspectives of every battle. Three addressing modes: player_tag (the usual sweep, defaults to the caller); battle_id alone (ONE battle, both sides); deck_hash alone (corpus-wide battles for that exact deck with a deck_stats aggregate and deliberately no pooled win rate). live: true polls the player's battle log once before answering (one live fetch) - the 'what did they just play' path; the recorded log is otherwise within an hour for anyone recently asked about.",
    inputSchema: {
      type: "object",
      properties: {
        player_tag: TAG_SCHEMA,
        on_behalf_of: ON_BEHALF_OF_SCHEMA,
        ...WINDOW_ARGS,
        mode: MODE_SCHEMA,
        game_mode_id: {
          type: "integer",
          description: "Exact game mode id from the API.",
        },
        opponent_tag: {
          type: "string",
          description: "Only battles against this tag.",
        },
        outcome: { type: "string", enum: ["win", "loss", "draw"] },
        with_card: {
          type: "integer",
          description: "Card id present in YOUR deck.",
        },
        against_card: {
          type: "integer",
          description: "Card id present in an OPPONENT deck.",
        },
        deck_hash: {
          type: "string",
          description:
            "Exact deck identity (see battles_decks). Without player_tag: corpus-wide.",
        },
        battle_id: {
          type: "string",
          description: "Fetch exactly this battle (both perspectives).",
        },
        game_mode: {
          type: "string",
          description:
            "Case-insensitive substring of the game's mode name ('chaos', 'crazy'); discover names with battles_performance group_by: 'mode'.",
        },
        live: {
          type: "boolean",
          description:
            "Poll this player's battle log from the game first (one live fetch), then answer from the record.",
        },
        cursor: {
          type: "string",
          description: "Opaque token from a previous response's next_cursor.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          default: 25,
          description: "Battles per page; above 25 needs verbosity: 'compact'.",
        },
        include_total: {
          type: "boolean",
          description:
            "Also return total_count across ALL pages (one cheap count query).",
        },
        verbosity: VERBOSITY(
          "drops per-card decks, support cards and tower_hp (deck_hash stays); use it for wide sweeps.",
        ),
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      // Addressing modes (design handoff 2026-09-05): battle_id and
      // corpus-wide deck_hash need no subject tag - recorded battles
      // are universal reads.
      const byBattle = args.battle_id !== undefined;
      const corpusDeck = !byBattle && args.deck_hash && !args.player_tag;
      let tag = null;
      if (!byBattle && !corpusDeck) {
        const s = await subject(
          ctx.db,
          ctx.account,
          args.player_tag,
          "battles",
          args.on_behalf_of,
        );
        tag = s.tag;
      }
      if (args.live === true) {
        if (!tag)
          throw new ToolFailure(
            "bad_request",
            "live: true needs a player (player_tag or the default subject), not battle_id or a corpus-wide deck_hash.",
          );
        if (!ctx.live)
          throw new ToolFailure(
            "live_unavailable",
            "The live lane is not configured here.",
            "Call again without live: true.",
          );
        await spendLiveQuota(ctx);
        const result = await ctx.live(ctx.db, {
          endpoint: "player_battlelog",
          entityKey: tag,
        });
        if (!result.ok)
          throw new ToolFailure(
            "live_unavailable",
            "No gateway completed the live battle-log poll in time.",
            "Serving recorded data: call again without live: true.",
          );
      }
      const win = resolveWindow(ctx, args);
      const tz = win.timezone;
      const limit = Math.min(Math.max(Number(args.limit ?? 25), 1), 50);
      const compact = args.verbosity === "compact";
      // Full battles carry BOTH sides' decks and tower_hp; above the
      // default page size that reliably overruns the result cap. Refuse
      // loudly instead.
      if (!compact && Number(args.limit ?? 25) > 25) {
        throw new ToolFailure(
          "bad_request",
          "limit above 25 requires verbosity: 'compact' (full battles carry both sides' decks).",
          "Use compact for wide sweeps; deck_hash survives compaction.",
        );
      }
      const where = [];
      const params = [];
      if (byBattle) {
        params.push(String(args.battle_id));
        where.push(`bp.battle_id = $1`, `bp.side = 0`);
      } else if (corpusDeck) {
        where.push("bp.side is not null");
      } else {
        params.push(tag);
        where.push("bp.player_tag = $1");
      }
      const add = (clause, value) => {
        params.push(value);
        where.push(clause.replace("?", `$${params.length}`));
      };
      const { from, to } = win;
      if (from) add("b.battle_time >= ?", from);
      requireEnum(args.outcome, ["win", "loss", "draw"], "outcome");
      if (args.with_card !== undefined) {
        const cardId = Number(args.with_card);
        if (
          !Number.isInteger(cardId) ||
          cardId < 26000000 ||
          cardId >= 29000000
        ) {
          throw new ToolFailure(
            "bad_request",
            `with_card ${args.with_card} is not a Clash Royale card id.`,
            "Card ids are 8-digit values like 26000000; resolve names to ids with cards_catalog.",
          );
        }
      }
      if (to) add("b.battle_time < ?", to);
      modeClause(args, add);
      if (args.game_mode_id !== undefined)
        add("b.game_mode_id = ?", args.game_mode_id);
      if (args.game_mode)
        add("b.game_mode_name ilike ?", `%${String(args.game_mode)}%`);
      if (args.outcome) add("bp.outcome = ?", args.outcome);
      if (args.deck_hash) add("bp.deck_hash = ?", args.deck_hash);
      if (args.with_card !== undefined) {
        add(
          `bp.deck->'cards' @> ?::jsonb`,
          JSON.stringify([{ id: args.with_card }]),
        );
      }
      let opponent = null;
      if (args.opponent_tag) {
        try {
          opponent = normalizeTag(String(args.opponent_tag));
        } catch {
          throw new ToolFailure(
            "invalid_tag",
            `Invalid opponent_tag: ${args.opponent_tag}`,
          );
        }
        add(
          `exists (select 1 from battle_participant o
                   where o.battle_id = bp.battle_id and o.side <> bp.side and o.player_tag = ?)`,
          opponent,
        );
      }
      if (args.against_card !== undefined) {
        add(
          `exists (select 1 from battle_participant o
                   where o.battle_id = bp.battle_id and o.side <> bp.side
                     and o.deck->'cards' @> ?::jsonb)`,
          JSON.stringify([{ id: args.against_card }]),
        );
      }
      if (args.cursor !== undefined) {
        // Keyset on (battle_time, battle_id): battles are ordered by when
        // they were PLAYED, never by insert order — the archive backfill
        // made those permanently different.
        const m = /^(.+)\|([0-9a-f]{64})$/.exec(String(args.cursor));
        if (!m || Number.isNaN(Date.parse(m[1]))) {
          throw new ToolFailure(
            "bad_request",
            "Invalid cursor.",
            "Cursors are opaque tokens; restart from the first page.",
          );
        }
        // Integrity: the id half must be a real battle. A forged or
        // corrupted-but-parseable cursor otherwise returns an empty page
        // indistinguishable from end-of-data (round-3 finding). Battles
        // are never deleted, so a genuine cursor always passes.
        const { rows: cursorRow } = await ctx.db.query(
          `select 1 from battle where battle_id = $1`,
          [m[2]],
        );
        if (!cursorRow[0]) {
          throw new ToolFailure(
            "bad_request",
            "Invalid cursor (not issued by this server, or corrupted).",
            "Cursors are opaque tokens; restart from the first page.",
          );
        }
        params.push(m[1], m[2]);
        where.push(
          `(b.battle_time, b.battle_id) < ($${params.length - 1}, $${params.length})`,
        );
      }

      const { rows } = await ctx.db.query(
        `select b.cursor, b.battle_id, b.battle_time, b.type, b.game_mode_id, b.game_mode_name,
                b.arena, b.league_number,
                bp.player_tag, bp.side, bp.crowns, bp.trophy_change, bp.starting_trophies, bp.deck, bp.deck_hash,
                bp.elixir_leaked, bp.tower_hp, bp.outcome
         from battle_participant bp
         join battle b on b.battle_id = bp.battle_id
         where ${where.join(" and ")}
         order by b.battle_time desc, b.battle_id desc
         limit ${limit}`,
        params,
      );

      let others = new Map();
      if (rows.length > 0) {
        const ids = rows.map((r) => r.battle_id);
        const sides = rows.map((r) => r.side);
        const { rows: rest } = await ctx.db.query(
          tag
            ? `select o.battle_id, o.player_tag, o.side, o.crowns, o.deck_hash, o.clan_tag,
                  o.deck, o.tower_hp, p.name
           from battle_participant o join player p on p.player_tag = o.player_tag
           where o.battle_id = any($1) and o.player_tag <> $2`
            : `select o.battle_id, o.player_tag, o.side, o.crowns, o.deck_hash, o.clan_tag,
                  o.deck, o.tower_hp, p.name
           from battle_participant o join player p on p.player_tag = o.player_tag
           join unnest($1::text[], $2::int[]) me(battle_id, side)
             on me.battle_id = o.battle_id
           where o.side <> me.side`,
          tag ? [ids, tag] : [ids, sides],
        );
        others = rest.reduce((map, r) => {
          if (!map.has(r.battle_id)) map.set(r.battle_id, []);
          map.get(r.battle_id).push(r);
          return map;
        }, new Map());
      }

      const battles = rows.map((r) => {
        const rest = others.get(r.battle_id) ?? [];
        const shape = (o) => ({
          player_tag: o.player_tag,
          name: o.name,
          // Explicit, so "never captured" is distinguishable from "field not
          // populated on this path" (feedback #14).
          name_known: o.name !== null,
          crowns: o.crowns,
          deck_hash: o.deck_hash,
          clan_tag: o.clan_tag,
          ...roundsPlayed(o.deck),
          ...(compact
            ? {}
            : { deck: o.deck, tower_hp: normalizeTowerHp(o.tower_hp) }),
        });
        return {
          battle_id: r.battle_id,
          battle_time: r.battle_time.toISOString(),
          ...(tz ? { battle_time_local: formatLocal(r.battle_time, tz) } : {}),
          type: r.type,
          game_mode: { id: r.game_mode_id, name: r.game_mode_name },
          arena: r.arena,
          league_number: r.league_number,
          me: {
            ...(tag ? {} : { player_tag: r.player_tag }),
            outcome: r.outcome,
            crowns: r.crowns,
            trophy_change: r.trophy_change,
            starting_trophies: r.starting_trophies,
            deck_hash: r.deck_hash,
            ...roundsPlayed(r.deck),
            ...(compact
              ? {}
              : {
                  deck: r.deck,
                  elixir_leaked:
                    r.elixir_leaked === null ? null : Number(r.elixir_leaked),
                  tower_hp: normalizeTowerHp(r.tower_hp),
                }),
          },
          teammates: rest.filter((o) => o.side === r.side).map(shape),
          opponents: rest.filter((o) => o.side !== r.side).map(shape),
        };
      });

      let deckStats;
      if (corpusDeck) {
        // The honest aggregate: counts, W-L, distinct pilots, span.
        // Deliberately NO win rate - a deck's pooled rate describes who
        // plays it (docs/META-INTEL §2); lift with a sample size is an
        // agent tool (battles_meta_decks).
        const { rows: ds } = await ctx.db.query(
          `select count(*)::int as battles,
                  count(*) filter (where bp.outcome = 'win')::int as wins,
                  count(*) filter (where bp.outcome = 'loss')::int as losses,
                  count(distinct bp.player_tag)::int as players,
                  min(b.battle_time) as first_used,
                  max(b.battle_time) as last_used
           from battle_participant bp join battle b on b.battle_id = bp.battle_id
           where bp.deck_hash = $1`,
          [String(args.deck_hash)],
        );
        deckStats = {
          battles: ds[0].battles,
          wins: ds[0].wins,
          losses: ds[0].losses,
          players: ds[0].players,
          first_used: ds[0].first_used?.toISOString() ?? null,
          last_used: ds[0].last_used?.toISOString() ?? null,
        };
      }

      let totalCount;
      if (args.include_total === true) {
        // Same filters minus the cursor: the cursor positions a page, the
        // total describes the whole match set.
        const countWhere = where.filter(
          (w) => !w.includes("(b.battle_time, b.battle_id) <"),
        );
        const { rows: cnt } = await ctx.db.query(
          `select count(*)::int as n
           from battle_participant bp join battle b on b.battle_id = bp.battle_id
           where ${countWhere.join(" and ")}`,
          params.slice(0, countWhere.length),
        );
        totalCount = cnt[0].n;
      }

      // Empty page + a window that ends before the first recorded battle
      // reads as "player was inactive" unless we say otherwise.
      const caveats = [];
      if (battles.length === 0 && to && tag) {
        const { rows: firstRec } = await ctx.db.query(
          `select min(battle_time) as first from battle_participant where player_tag = $1`,
          [tag],
        );
        const first = firstRec[0]?.first;
        if (first && to.getTime() < first.getTime()) {
          caveats.push(
            `window_precedes_recording: the window ends before this player's first recorded battle (${first.toISOString()}); emptiness means no COVERAGE, not inactivity.`,
          );
        }
      }

      return {
        ...(tag ? { player_tag: tag } : {}),
        ...(byBattle ? { battle_id: String(args.battle_id) } : {}),
        ...(deckStats
          ? { deck_hash: String(args.deck_hash), deck_stats: deckStats }
          : {}),
        applied: appliedBlock({
          window: win.echo,
          limit,
          verbosity: compact ? "compact" : "full",
          mode: args.mode,
          outcome: args.outcome,
          game_mode: args.game_mode,
          game_mode_id: args.game_mode_id,
          opponent_tag: opponent ?? undefined,
          deck_hash: args.deck_hash,
          with_card: args.with_card,
          against_card: args.against_card,
          live: args.live === true ? true : undefined,
        }),
        battles,
        ...(totalCount !== undefined ? { total_count: totalCount } : {}),
        // Explicit null = end of results (absent-vs-null was ambiguous).
        next_cursor:
          rows.length === limit
            ? `${rows[rows.length - 1].battle_time.toISOString()}|${rows[rows.length - 1].battle_id}`
            : null,
        notes: notes(
          caveats,
          deckStats &&
            "deck_stats carries no pooled win rate by design: a deck's rate describes who plays it; battles_meta_decks has shrunk rates with sample sizes.",
          "Duel rows (riverRaceDuel*) collapse up to three games: crowns sum across rounds, tower_hp describes the final round only, deck_hash is null, decks sit under deck.rounds[] and rounds_played says how many.",
          compact
            ? null
            : "Deck card levels are the in-game 1-16 scale; evolution marks the FORM played (1 = Evolution, 2 = Hero), never a level; tower_hp is hitpoints REMAINING at the end (null = not reported by the game).",
        ),
        docs: BATTLE_DOCS,
        meta: await buildMeta(
          ctx.db,
          ctx.account,
          tag ?? rows[0]?.player_tag ?? "#",
          ["player_battlelog"],
          { timezone: tz },
        ),
      };
    },
  },

  battles_performance: {
    description:
      'Computed record over a window: W/L/D, win rate, crowns for/against, net trophies, three-crown rate, streaks. compare_from/compare_to or before_after runs a second window server-side for "since X vs before" questions (before_after wins over compare_*); group_by week is the trend view and group_by mode the "what have I been playing" view.',
    inputSchema: {
      type: "object",
      properties: {
        player_tag: TAG_SCHEMA,
        on_behalf_of: ON_BEHALF_OF_SCHEMA,
        ...WINDOW_ARGS,
        last_n_battles: {
          type: "integer",
          minimum: 1,
          maximum: 500,
          description: "Sample the most recent N battles instead of a window.",
        },
        mode: MODE_SCHEMA,
        deck_hash: {
          type: "string",
          description: "Only battles on this exact deck (see battles_decks).",
        },
        compare_from: { type: "string", description: WINDOW_FROM_DESC },
        compare_to: { type: "string", description: WINDOW_TO_DESC },
        group_by: {
          type: "string",
          enum: ["week", "mode"],
          description:
            "week: weekly series (ISO weeks). mode: per named game mode, event modes included. Overrides before_after and compare_*.",
        },
        before_after: {
          type: "string",
          description:
            "Date splitting two windows: [from..date) vs [date..to], e.g. before vs after a deck change.",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const tag = (
        await subject(
          ctx.db,
          ctx.account,
          args.player_tag,
          "summary",
          args.on_behalf_of,
        )
      ).tag;
      const win = resolveWindow(ctx, args);
      const tz = win.timezone;

      const segment = async ({ from, to, lastN }) => {
        const where = ["bp.player_tag = $1", `bp.outcome is not null`];
        const params = [tag];
        const add = (clause, value) => {
          params.push(value);
          where.push(clause.replace("?", `$${params.length}`));
        };
        if (from) add("b.battle_time >= ?", from);
        if (to) add("b.battle_time < ?", to);
        modeClause(args, add);
        if (args.deck_hash) add("bp.deck_hash = ?", args.deck_hash);
        requireOrderedWindow(from, to);
        const {
          rows: [row],
        } = await ctx.db.query(
          `with sample as materialized (
             select bp.outcome, bp.crowns, bp.trophy_change, b.battle_time, b.battle_id,
                    b.type_class, b.type,
                    (select max(o.crowns) from battle_participant o
                     where o.battle_id = bp.battle_id and o.side <> bp.side) as opp_crowns
             from battle_participant bp join battle b on b.battle_id = bp.battle_id
             where ${where.join(" and ")}
             order by b.battle_time desc, b.battle_id desc
             ${lastN ? `limit ${lastN}` : ""}
           ), decided as (
             select outcome, row_number() over w as rn, first_value(outcome) over w as latest
             from sample where outcome in ('win','loss')
             window w as (order by battle_time desc, battle_id desc)
           ), streak as (
             select coalesce(min(rn) filter (where outcome <> latest) - 1, count(*))
                    * case when min(latest) = 'loss' then -1 else 1 end as n
             from decided
           )
           select count(*)::int as battles,
                  count(*) filter (where outcome = 'win')::int as wins,
                  count(*) filter (where outcome = 'loss')::int as losses,
                  count(*) filter (where outcome = 'draw')::int as draws,
                  count(*) filter (where type_class = 'boat')::int as boat_battles,
                  count(*) filter (where outcome = 'win' and type_class = 'pvp')::int as decided_wins,
                  count(*) filter (where outcome = 'loss' and type_class = 'pvp')::int as decided_losses,
                  count(*) filter (where type = any($${params.length + 1}))::int as duel_battles,
                  coalesce(sum(crowns),0)::int as crowns_for,
                  coalesce(sum(opp_crowns),0)::int as crowns_against,
                  coalesce(sum(trophy_change),0)::int as net_trophies,
                  count(*) filter (where outcome in ('win','loss') and type_class = 'pvp'
                                   and type <> all($${params.length + 1}))::int as head_to_head,
                  count(*) filter (where crowns = 3 and type_class = 'pvp'
                                   and type <> all($${params.length + 1}))::int as three_crowns,
                  (select n::int from streak) as current_streak
           from sample`,
          [...params, DUEL_TYPES],
        );
        const {
          three_crowns,
          head_to_head,
          decided_wins,
          decided_losses,
          ...counts
        } = row;
        // Decided = head-to-head wins + losses. Boat attacks (a static
        // defense, no live opponent) and draws stay in `battles` and in
        // W/L/D but never in the win_rate denominator (feedback #23).
        const decided = decided_wins + decided_losses;
        return {
          ...counts,
          decided_battles: decided,
          decided_wins,
          decided_losses,
          win_rate:
            decided > 0 ? Number((decided_wins / decided).toFixed(3)) : null,
          head_to_head_battles: head_to_head,
          // Three crowns means the king tower fell, which only reads as a
          // sweep on a single game; duel rows sum crowns across rounds
          // and boat attacks have no king tower (playtest 2026-09-09).
          three_crown_rate:
            head_to_head > 0
              ? Number((three_crowns / head_to_head).toFixed(3))
              : null,
        };
      };

      if (
        args.last_n_battles !== undefined &&
        (!Number.isInteger(args.last_n_battles) ||
          args.last_n_battles < 1 ||
          args.last_n_battles > 500)
      ) {
        throw new ToolFailure(
          "bad_request",
          `last_n_battles must be an integer from 1 to 500 (got ${args.last_n_battles}).`,
        );
      }
      const { from, to } = win;
      let result;
      const caveats = [];
      if (args.group_by === "mode") {
        const where = ["bp.player_tag = $1", "bp.outcome is not null"];
        const params = [tag];
        const add = (clause, value) => {
          params.push(value);
          where.push(clause.replace("?", `$${params.length}`));
        };
        if (from) add("bp.battle_time >= ?", from);
        if (to) add("bp.battle_time < ?", to);
        modeClause(args, add);
        if (args.deck_hash) add("bp.deck_hash = ?", args.deck_hash);
        const { rows } = await ctx.db.query(
          `select b.game_mode_name as game_mode, b.type,
                  count(*)::int as battles,
                  count(*) filter (where bp.outcome = 'win')::int as wins,
                  count(*) filter (where bp.outcome = 'loss')::int as losses,
                  count(*) filter (where bp.outcome = 'draw')::int as draws,
                  max(b.battle_time) as last_played
           from battle_participant bp join battle b on b.battle_id = bp.battle_id
           where ${where.join(" and ")}
           group by b.game_mode_name, b.type
           order by count(*) desc`,
          params,
        );
        result = {
          by_mode: rows.map((r) => ({
            game_mode: r.game_mode,
            type: r.type,
            battles: r.battles,
            wins: r.wins,
            losses: r.losses,
            draws: r.draws,
            win_rate:
              r.wins + r.losses > 0
                ? Number((r.wins / (r.wins + r.losses)).toFixed(3))
                : null,
            last_played: r.last_played?.toISOString() ?? null,
          })),
        };
        caveats.push(
          "Rows are keyed by the pair (game_mode, type): the same mode name recurs under different API types, and 'unknown' is the API's own value for some friendly and event battles.",
          "Per-row win_rate is wins/(wins+losses) within that row, boat rows included; filter battles_query by game_mode to drill in.",
        );
        if (args.before_after || args.compare_from || args.compare_to)
          caveats.push(
            "group_by takes precedence; before_after and compare_* were ignored.",
          );
      } else if (args.group_by === "week") {
        const where = ["bp.player_tag = $1", "bp.outcome is not null"];
        const params = [tag];
        const add = (clause, value) => {
          params.push(value);
          where.push(clause.replace("?", `$${params.length}`));
        };
        if (from) add("bp.battle_time >= ?", from);
        if (to) add("bp.battle_time < ?", to);
        modeClause(args, add);
        if (args.deck_hash) add("bp.deck_hash = ?", args.deck_hash);
        const { rows } = await ctx.db.query(
          `select to_char(date_trunc('week', bp.battle_time), 'IYYY-"W"IW') as iso_week,
                  date_trunc('week', bp.battle_time)::date::text as week_of,
                  count(*)::int as battles,
                  count(*) filter (where bp.outcome = 'win')::int as wins,
                  count(*) filter (where bp.outcome = 'loss')::int as losses,
                  count(*) filter (where bp.outcome = 'draw')::int as draws,
                  count(*) filter (where bp.trophy_change is not null)::int as trophy_battles,
                  coalesce(sum(bp.trophy_change), 0)::int as net_trophies
           from battle_participant bp join battle b on b.battle_id = bp.battle_id
           where ${where.join(" and ")}
           group by date_trunc('week', bp.battle_time)
           order by date_trunc('week', bp.battle_time)`,
          params,
        );
        result = {
          weekly: rows.map((r) => ({
            iso_week: r.iso_week,
            week_of: r.week_of,
            battles: r.battles,
            wins: r.wins,
            losses: r.losses,
            draws: r.draws,
            trophy_battles: r.trophy_battles,
            net_trophies: r.net_trophies,
            win_rate:
              r.wins + r.losses > 0
                ? Number((r.wins / (r.wins + r.losses)).toFixed(3))
                : null,
          })),
        };
        caveats.push(
          "week_of is the ISO week's Monday (UTC); win_rate = wins/(wins+losses), draws excluded.",
          "net_trophies covers only trophy_battles: war and event modes carry no trophies, so a rising win_rate with flat trophies usually means war-heavy weeks.",
        );
        if (args.before_after || args.compare_from || args.compare_to)
          caveats.push(
            "group_by takes precedence; before_after and compare_* were ignored.",
          );
      } else if (args.before_after) {
        const split = resolveInstant(tz, args.before_after);
        if (!split)
          throw new ToolFailure(
            "bad_request",
            `Unparseable before_after: ${args.before_after}`,
          );
        result = {
          before: await segment({ from, to: split }),
          after: await segment({ from: split, to }),
          split_at: split.toISOString(),
        };
        if (args.compare_from || args.compare_to)
          caveats.push(
            "before_after takes precedence; compare_from/compare_to were ignored.",
          );
      } else if (args.compare_from || args.compare_to) {
        const cf = resolveInstant(tz, args.compare_from);
        const ct = resolveInstant(tz, args.compare_to, { endOfDay: true });
        result = {
          window: await segment({ from, to, lastN: args.last_n_battles }),
          compare_window: await segment({ from: cf, to: ct }),
        };
      } else {
        result = {
          window: await segment({ from, to, lastN: args.last_n_battles }),
        };
      }
      const grouped = Boolean(args.group_by);
      return {
        player_tag: tag,
        applied: appliedBlock({
          window: win.echo,
          mode: args.mode,
          deck_hash: args.deck_hash,
          last_n_battles:
            args.last_n_battles && !args.before_after && !grouped
              ? args.last_n_battles
              : undefined,
          group_by: args.group_by,
          before_after: !grouped ? args.before_after : undefined,
          compare_window:
            !grouped &&
            !args.before_after &&
            (args.compare_from || args.compare_to)
              ? {
                  from:
                    resolveInstant(tz, args.compare_from)?.toISOString() ??
                    null,
                  to:
                    resolveInstant(tz, args.compare_to, {
                      endOfDay: true,
                    })?.toISOString() ?? null,
                }
              : undefined,
        }),
        ...result,
        notes: notes(
          caveats,
          grouped
            ? null
            : [
                "win_rate = decided_wins / decided_battles, where decided_battles = decided_wins + decided_losses: boat battles and draws are outside both sides, while wins/losses still count boat wins.",
                "duel_battles collapse up to three games and count crowns once per round, so crowns_for/against mix units when duels are present.",
                "three_crown_rate = three-crown wins / head_to_head_battles, duels and boat battles excluded from both sides.",
              ],
        ),
        docs: DENOMINATOR_DOCS,
        meta: await buildMeta(ctx.db, ctx.account, tag, ["player_battlelog"], {
          timezone: tz,
        }),
      };
    },
  },

  battles_cards: {
    description:
      'Per-card win/loss attribution over recorded battles. perspective "mine": which of your cards carry. perspective "opponent": which enemy cards beat you (the nemesis question). Duels are excluded (no single deck).',
    inputSchema: {
      type: "object",
      properties: {
        player_tag: TAG_SCHEMA,
        on_behalf_of: ON_BEHALF_OF_SCHEMA,
        perspective: {
          type: "string",
          enum: ["mine", "opponent"],
          default: "mine",
        },
        ...WINDOW_ARGS,
        mode: MODE_SCHEMA,
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const tag = (
        await subject(
          ctx.db,
          ctx.account,
          args.player_tag,
          "summary",
          args.on_behalf_of,
        )
      ).tag;
      const win = resolveWindow(ctx, args);
      const mine = args.perspective !== "opponent";
      const where = ["bp.player_tag = $1", `bp.outcome in ('win','loss')`];
      const params = [tag];
      const add = (clause, value) => {
        params.push(value);
        where.push(clause.replace("?", `$${params.length}`));
      };
      if (win.from) add("b.battle_time >= ?", win.from);
      if (win.to) add("b.battle_time < ?", win.to);
      modeClause(args, add);

      const deckSource = mine
        ? `bp.deck`
        : `(select o.deck from battle_participant o
            where o.battle_id = bp.battle_id and o.side <> bp.side and o.deck is not null
            limit 1)`;
      const { rows } = await ctx.db.query(
        `select card->>'name' as name, (card->>'id')::bigint as id,
                coalesce((card->>'evolutionLevel')::int, 0) as evolution,
                count(*) filter (where bp.outcome = 'win')::int as wins,
                count(*) filter (where bp.outcome = 'loss')::int as losses
         from battle_participant bp
         join battle b on b.battle_id = bp.battle_id,
         lateral jsonb_array_elements(coalesce(${deckSource}->'cards', '[]'::jsonb)) card
         where ${where.join(" and ")}
         group by 1, 2, 3
         having count(*) >= 3
         order by count(*) desc
         limit 120`,
        params,
      );
      return {
        player_tag: tag,
        applied: appliedBlock({
          window: win.echo,
          perspective: mine ? "mine" : "opponent",
          mode: args.mode,
          min_battles: 3,
        }),
        cards: rows.map((r) => ({
          id: Number(r.id),
          name: r.name,
          ...(r.evolution > 0 ? { evolution: r.evolution } : {}),
          battles: r.wins + r.losses,
          wins: r.wins,
          losses: r.losses,
          win_rate: Number((r.wins / (r.wins + r.losses)).toFixed(3)),
        })),
        notes: notes(
          mine
            ? "win_rate is YOUR record when this card is in your deck."
            : "win_rate is YOUR record when this card appears in the OPPONENT deck; low means nemesis.",
          FORM_ROWS_NOTE,
        ),
        docs: docsRef("battles", "deck-identity-and-forms"),
        meta: await buildMeta(ctx.db, ctx.account, tag, ["player_battlelog"], {
          timezone: win.timezone,
        }),
      };
    },
  },

  battles_decks: {
    description:
      "Battles grouped by exact deck identity (deck_hash): per-deck record, first/last used, win rate, share of battles. Deck identity is the exact card set played (some event modes field more or fewer than 8). Unbounded by default and says so in applied.window; pass a deck_hash to battles_query or battles_performance to drill in.",
    inputSchema: {
      type: "object",
      properties: {
        player_tag: TAG_SCHEMA,
        on_behalf_of: ON_BEHALF_OF_SCHEMA,
        ...WINDOW_ARGS,
        mode: MODE_SCHEMA,
        sort: {
          type: "string",
          enum: ["battles", "wins", "win_rate"],
          default: "battles",
          description: "win_rate sorting respects min_battles.",
        },
        min_battles: {
          type: "integer",
          minimum: 1,
          description: "Drop decks with fewer battles than this.",
        },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 40 },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const tag = (
        await subject(
          ctx.db,
          ctx.account,
          args.player_tag,
          "summary",
          args.on_behalf_of,
        )
      ).tag;
      const win = resolveWindow(ctx, args);
      const where = ["bp.player_tag = $1", "bp.deck_hash is not null"];
      const params = [tag];
      const add = (clause, value) => {
        params.push(value);
        where.push(clause.replace("?", `$${params.length}`));
      };
      if (win.from) add("b.battle_time >= ?", win.from);
      if (win.to) add("b.battle_time < ?", win.to);
      modeClause(args, add);
      const { rows } = await ctx.db.query(
        `select bp.deck_hash,
                min(b.battle_time) as first_used, max(b.battle_time) as last_used,
                count(*)::int as battles,
                count(*) filter (where bp.outcome = 'win')::int as wins,
                count(*) filter (where bp.outcome = 'loss')::int as losses,
                count(*) filter (where bp.outcome = 'draw')::int as draws,
                (array_agg(bp.deck order by b.battle_time desc))[1] as deck
         from battle_participant bp join battle b on b.battle_id = bp.battle_id
         where ${where.join(" and ")}
         group by bp.deck_hash
         order by count(*) desc
         limit 100`,
        params,
      );
      const totalBattles = rows.reduce((n, r) => n + r.battles, 0);
      let shaped = rows;
      if (args.min_battles) {
        shaped = shaped.filter((r) => r.battles >= args.min_battles);
      }
      const wr = (r) =>
        r.wins + r.losses > 0 ? r.wins / (r.wins + r.losses) : -1;
      requireEnum(args.sort, ["battles", "wins", "win_rate"], "sort");
      if (args.sort === "wins") shaped.sort((a, z) => z.wins - a.wins);
      else if (args.sort === "win_rate") shaped.sort((a, z) => wr(z) - wr(a));
      const limit = Math.min(Math.max(Number(args.limit ?? 40), 1), 100);
      shaped = shaped.slice(0, limit);
      return {
        player_tag: tag,
        applied: appliedBlock({
          window: win.echo,
          mode: args.mode,
          sort: args.sort ?? "battles",
          min_battles: args.min_battles,
          limit,
        }),
        total_battles_in_window: totalBattles,
        decks: shaped.map((r) => ({
          deck_hash: r.deck_hash,
          cards: deckCards(r.deck),
          ...towerTroop(r.deck),
          battles: r.battles,
          wins: r.wins,
          losses: r.losses,
          draws: r.draws,
          win_rate:
            r.wins + r.losses > 0
              ? Number((r.wins / (r.wins + r.losses)).toFixed(3))
              : null,
          share_of_battles:
            totalBattles > 0
              ? Number((r.battles / totalBattles).toFixed(3))
              : null,
          first_used: r.first_used.toISOString(),
          last_used: r.last_used.toISOString(),
        })),
        notes: notes(
          win.source === "unbounded"
            ? "No window was given, so this is the whole recorded history for the player; pass from/to for a period."
            : null,
          "Deck identity includes each card's form and the tower troop, so two decks with the same eight names can be different decks.",
        ),
        docs: docsRef("battles", "deck-identity-and-forms"),
        meta: await buildMeta(ctx.db, ctx.account, tag, ["player_battlelog"], {
          timezone: win.timezone,
        }),
      };
    },
  },

  battles_meta_decks: {
    description:
      "Observed deck meta for a segment: the whole corpus (default), or segment.clan_tag / segment.player_tag / segment.collection. Per exact deck identity: decided player-battle observations (not unique matches), record, distinct players, usage share, raw and shrunk win rates. Default window 28 days. No tier lists: what the recorded data shows, with sample sizes.",
    inputSchema: {
      type: "object",
      properties: {
        segment: SEGMENT_SCHEMA,
        ...WINDOW_ARGS,
        mode: MODE_SCHEMA,
        min_battles: {
          type: "integer",
          minimum: 1,
          default: 5,
          description: "Decided observations a deck needs to be listed.",
        },
        sort: {
          type: "string",
          enum: ["battles", "shrunk_win_rate", "players"],
          default: "battles",
        },
        limit: { type: "integer", minimum: 1, maximum: 40, default: 20 },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const params = [];
      const seg = await segmentFilter(ctx, args, params);
      const win = resolveWindow(ctx, args, { defaultDays: 28 });
      const scope = []; // segment + window + mode: the population considered
      if (seg.where) scope.push(seg.where);
      const from = win.from.toISOString();
      params.push(from);
      scope.push(`b.battle_time >= $${params.length}`);
      const to = win.to;
      if (to) {
        params.push(to);
        scope.push(`b.battle_time < $${params.length}`);
      }
      requireEnum(args.mode, MODE_GROUPS, "mode");
      if (args.mode) {
        params.push(typesForModeGroup(args.mode));
        scope.push(`b.type = any($${params.length})`);
      }
      const where = [
        ...scope,
        "bp.deck_hash is not null",
        "bp.outcome in ('win','loss')",
        "b.type_class = 'pvp'",
      ];
      const excluded = await excludedBreakdown(ctx.db, scope, params);
      const prior = await corpusPrior(ctx.db, {
        from,
        to,
        types: args.mode ? typesForModeGroup(args.mode) : null,
      });
      const { rows } = await ctx.db.query(
        `select bp.deck_hash,
                count(*)::int as battles,
                count(*) filter (where bp.outcome = 'win')::int as wins,
                count(*) filter (where bp.outcome = 'loss')::int as losses,
                count(distinct bp.player_tag)::int as players,
                min(b.battle_time) as first_used,
                max(b.battle_time) as last_used,
                (array_agg(bp.deck order by b.battle_time desc))[1] as deck
         from battle_participant bp join battle b on b.battle_id = bp.battle_id
         where ${where.join(" and ")}
         group by bp.deck_hash`,
        params,
      );
      const totalDecided = rows.reduce((n, r) => n + r.battles, 0);
      const totalWins = rows.reduce((n, r) => n + r.wins, 0);
      const mean = totalDecided > 0 ? totalWins / totalDecided : 0.5;
      const priorMean = prior.mean ?? 0.5;
      const sufficient = totalDecided >= META_METHODOLOGY.segment_min_decided;
      const minBattles = args.min_battles ?? 5;
      let shaped = rows
        .filter((r) => r.battles >= minBattles)
        .map((r) => ({
          deck_hash: r.deck_hash,
          cards: deckCards(r.deck),
          ...towerTroop(r.deck),
          battles: r.battles,
          wins: r.wins,
          losses: r.losses,
          players: r.players,
          usage_share:
            totalDecided > 0
              ? Number((r.battles / totalDecided).toFixed(3))
              : null,
          win_rate:
            r.wins + r.losses > 0
              ? Number((r.wins / (r.wins + r.losses)).toFixed(3))
              : null,
          ...(sufficient
            ? {
                shrunk_win_rate: ebShrink(r.wins, r.wins + r.losses, priorMean),
              }
            : {}),
          first_used: r.first_used.toISOString(),
          last_used: r.last_used.toISOString(),
        }));
      const sort = args.sort ?? "battles";
      shaped.sort((a, z) =>
        sort === "shrunk_win_rate"
          ? (z.shrunk_win_rate ?? z.win_rate) -
            (a.shrunk_win_rate ?? a.win_rate)
          : sort === "players"
            ? z.players - a.players
            : z.battles - a.battles,
      );
      const limit = Math.min(args.limit ?? 20, 40);
      shaped = shaped.slice(0, limit);
      return {
        applied: appliedBlock({
          segment: seg.echo,
          window: win.echo,
          mode: args.mode,
          min_battles: minBattles,
          sort,
          limit,
        }),
        methodology: META_METHODOLOGY,
        decided_battles: totalDecided,
        segment_win_rate: totalDecided > 0 ? Number(mean.toFixed(3)) : null,
        prior_win_rate: Number(priorMean.toFixed(3)),
        prior_basis: prior.mean === null ? "neutral_0.5" : "corpus_window",
        ...(sufficient
          ? {}
          : {
              insufficient_sample: true,
              insufficient_sample_floor: META_METHODOLOGY.segment_min_decided,
            }),
        excluded,
        decks: shaped,
        notes: notes(SEGMENT_NOTES),
        docs: SEGMENT_DOCS,
        meta: responseMeta({
          as_of: new Date().toISOString(),
          ...(win.timezone ? { timezone_applied: win.timezone } : {}),
        }),
      };
    },
  },

  battles_meta_cards: {
    description:
      "Observed card meta for a segment: the whole corpus (default), or segment.clan_tag / segment.player_tag / segment.collection. Per card AND form (forms never merge): usage share among decided player-battle observations, distinct players, raw and shrunk win rates. Default window 28 days. What the recorded data shows, with sample sizes; never a tier list.",
    inputSchema: {
      type: "object",
      properties: {
        segment: SEGMENT_SCHEMA,
        ...WINDOW_ARGS,
        mode: MODE_SCHEMA,
        min_battles: {
          type: "integer",
          minimum: 1,
          default: 10,
          description: "Decided observations a card needs to be listed.",
        },
        sort: {
          type: "string",
          enum: ["usage", "shrunk_win_rate"],
          default: "usage",
        },
        limit: { type: "integer", minimum: 1, maximum: 130, default: 30 },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const params = [];
      const seg = await segmentFilter(ctx, args, params);
      const win = resolveWindow(ctx, args, { defaultDays: 28 });
      const scope = [];
      if (seg.where) scope.push(seg.where);
      const from = win.from.toISOString();
      params.push(from);
      scope.push(`b.battle_time >= $${params.length}`);
      const to = win.to;
      if (to) {
        params.push(to);
        scope.push(`b.battle_time < $${params.length}`);
      }
      requireEnum(args.mode, MODE_GROUPS, "mode");
      if (args.mode) {
        params.push(typesForModeGroup(args.mode));
        scope.push(`b.type = any($${params.length})`);
      }
      const where = [
        ...scope,
        "bp.deck ? 'cards'",
        "jsonb_array_length(bp.deck->'cards') > 0",
        "bp.outcome in ('win','loss')",
        "b.type_class = 'pvp'",
      ];
      const excluded = await excludedBreakdown(ctx.db, scope, params);
      const prior = await corpusPrior(ctx.db, {
        from,
        to,
        types: args.mode ? typesForModeGroup(args.mode) : null,
      });
      const { rows } = await ctx.db.query(
        `with sides as (
           select bp.player_tag, bp.outcome,
                  (c.value->>'id')::bigint as card_id,
                  c.value->>'name' as name,
                  coalesce((c.value->>'evolutionLevel')::int, 0) as evolution
           from battle_participant bp
           join battle b on b.battle_id = bp.battle_id
           cross join lateral jsonb_array_elements(bp.deck->'cards') c
           where ${where.join(" and ")}),
         totals as (
           select count(*)::int as decided,
                  count(*) filter (where bp.outcome = 'win')::int as wins
           from battle_participant bp
           join battle b on b.battle_id = bp.battle_id
           where ${where.join(" and ")})
         select s.card_id, s.name, s.evolution,
                count(*)::int as battles,
                count(*) filter (where s.outcome = 'win')::int as wins,
                count(*) filter (where s.outcome = 'loss')::int as losses,
                count(distinct s.player_tag)::int as players,
                (select decided from totals) as total_decided,
                (select wins from totals) as total_wins
         from sides s
         group by s.card_id, s.name, s.evolution`,
        params,
      );
      const totalDecided = rows[0]?.total_decided ?? 0;
      const mean =
        totalDecided > 0 ? (rows[0]?.total_wins ?? 0) / totalDecided : 0.5;
      const priorMean = prior.mean ?? 0.5;
      const sufficient = totalDecided >= META_METHODOLOGY.segment_min_decided;
      const minBattles = args.min_battles ?? 10;
      let shaped = rows
        .filter((r) => r.battles >= minBattles)
        .map((r) => ({
          card_id: Number(r.card_id),
          name: r.name,
          ...(r.evolution > 0 ? { evolution: r.evolution } : {}),
          battles: r.battles,
          wins: r.wins,
          losses: r.losses,
          players: r.players,
          usage_share:
            totalDecided > 0
              ? Number((r.battles / totalDecided).toFixed(3))
              : null,
          win_rate:
            r.wins + r.losses > 0
              ? Number((r.wins / (r.wins + r.losses)).toFixed(3))
              : null,
          ...(sufficient
            ? {
                shrunk_win_rate: ebShrink(r.wins, r.wins + r.losses, priorMean),
              }
            : {}),
        }));
      const sort = args.sort ?? "usage";
      shaped.sort((a, z) =>
        sort === "shrunk_win_rate"
          ? (z.shrunk_win_rate ?? z.win_rate) -
            (a.shrunk_win_rate ?? a.win_rate)
          : z.battles - a.battles,
      );
      const limit = Math.min(args.limit ?? 30, 130);
      shaped = shaped.slice(0, limit);
      return {
        applied: appliedBlock({
          segment: seg.echo,
          window: win.echo,
          mode: args.mode,
          min_battles: minBattles,
          sort,
          limit,
        }),
        methodology: META_METHODOLOGY,
        decided_battles: totalDecided,
        segment_win_rate: totalDecided > 0 ? Number(mean.toFixed(3)) : null,
        prior_win_rate: Number(priorMean.toFixed(3)),
        prior_basis: prior.mean === null ? "neutral_0.5" : "corpus_window",
        ...(sufficient
          ? {}
          : {
              insufficient_sample: true,
              insufficient_sample_floor: META_METHODOLOGY.segment_min_decided,
            }),
        excluded,
        cards: shaped,
        notes: notes(
          SEGMENT_NOTES,
          FORM_ROWS_NOTE,
          "Card win rates are heavily skill-confounded: compare shrunk rates within similar usage, never across segments.",
        ),
        docs: SEGMENT_DOCS,
        meta: responseMeta({
          as_of: new Date().toISOString(),
          ...(win.timezone ? { timezone_applied: win.timezone } : {}),
        }),
      };
    },
  },

  battles_trends: {
    description:
      "Weekly time series for a segment: the whole corpus (default), or segment.clan_tag / segment.player_tag / segment.collection. Per ISO week: battles, record, aggregate win rate, distinct active players, net trophies. Default 12 weeks; weeks or from/to set the window. Single-player weekly detail also lives in battles_performance group_by 'week'.",
    inputSchema: {
      type: "object",
      properties: {
        segment: SEGMENT_SCHEMA,
        weeks: {
          type: "integer",
          minimum: 1,
          maximum: 52,
          description: "How many ISO weeks back (default 12); or use from/to.",
        },
        ...WINDOW_ARGS,
        mode: MODE_SCHEMA,
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const params = [];
      const seg = await segmentFilter(ctx, args, params);
      const where = ["bp.outcome is not null"];
      if (seg.where) where.push(seg.where);
      const win = resolveWindow(ctx, args, { defaultDays: 12 * 7 });
      // Weeks are aligned: the window's start snaps to its ISO Monday so
      // the first row is a whole week.
      params.push(win.from);
      where.push(
        `b.battle_time >= date_trunc('week', $${params.length}::timestamptz)`,
      );
      if (win.to) {
        params.push(win.to);
        where.push(`b.battle_time < $${params.length}`);
      }
      requireEnum(args.mode, MODE_GROUPS, "mode");
      if (args.mode) {
        params.push(typesForModeGroup(args.mode));
        where.push(`b.type = any($${params.length})`);
      }
      const { rows } = await ctx.db.query(
        `select to_char(date_trunc('week', b.battle_time), 'IYYY-"W"IW') as iso_week,
                date_trunc('week', b.battle_time)::date::text as week_of,
                count(*)::int as battles,
                count(*) filter (where bp.outcome = 'win')::int as wins,
                count(*) filter (where bp.outcome = 'loss')::int as losses,
                count(distinct bp.player_tag)::int as players,
                count(*) filter (where bp.trophy_change is not null)::int as trophy_battles,
                coalesce(sum(bp.trophy_change), 0)::int as net_trophies
         from battle_participant bp join battle b on b.battle_id = bp.battle_id
         where ${where.join(" and ")}
         group by date_trunc('week', b.battle_time)
         order by date_trunc('week', b.battle_time)`,
        params,
      );
      return {
        applied: appliedBlock({
          segment: seg.echo,
          window: win.echo,
          weeks: args.weeks,
          mode: args.mode,
        }),
        weeks: rows.map((r) => ({
          iso_week: r.iso_week,
          week_of: r.week_of,
          battles: r.battles,
          wins: r.wins,
          losses: r.losses,
          players: r.players,
          win_rate:
            r.wins + r.losses > 0
              ? Number((r.wins / (r.wins + r.losses)).toFixed(3))
              : null,
          trophy_battles: r.trophy_battles,
          net_trophies: r.net_trophies,
        })),
        notes: notes(
          "Aggregate win_rate over a group moves with COMPOSITION (who played that week) as much as with skill; players per week is the tell.",
          "Recording start dates differ per player, so early weeks may be thin because capture was, not because play was.",
        ),
        docs: docsRef("recording", "completeness"),
        meta: responseMeta({
          as_of: new Date().toISOString(),
          ...(win.timezone ? { timezone_applied: win.timezone } : {}),
        }),
      };
    },
  },

  battles_levels: {
    description:
      "The Level Curve and Pilot Score: win rate by deck-average level gap across the recorded corpus, binned where the data lives, never extrapolated. Pass player_tag (or on_behalf_of) for a Pilot Score: actual minus the level-expected win rate, with a monthly trend and an experience cohort. Descriptive, with sample sizes on every bin and score. verbosity compact omits the curve rows.",
    inputSchema: {
      type: "object",
      properties: {
        on_behalf_of: ON_BEHALF_OF_SCHEMA,
        player_tag: {
          type: "string",
          description:
            "Score this player against the curve (Pilot Score + monthly trend). Omit for the curve alone.",
        },
        days: {
          type: "integer",
          minimum: 7,
          maximum: 365,
          default: 90,
          description: "Window for the curve and the score, ending now.",
        },
        mode: MODE_SCHEMA,
        verbosity: VERBOSITY(
          "omits the curve rows; the score and methodology are unchanged.",
        ),
        trophy_band: {
          type: "string",
          enum: [
            "under_5000",
            "5000_8000",
            "8000_11000",
            "11000_13000",
            "13000_plus",
          ],
          description:
            "Both participants must have starting trophies in this band; conditions the curve and the scored observations on the same population.",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const days = Number(args.days ?? 90);
      if (!Number.isInteger(days) || days < 7 || days > 365)
        throw new ToolFailure("bad_request", "days must be 7-365.");
      let focus = null;
      // Same as war_history: being told who is asking is a focus, not noise.
      if (args.player_tag !== undefined || args.on_behalf_of)
        focus = (
          await subject(
            ctx.db,
            ctx.account,
            args.player_tag,
            "summary",
            args.on_behalf_of,
          )
        ).tag;
      const BANDS = {
        under_5000: [0, 5000],
        "5000_8000": [5000, 8000],
        "8000_11000": [8000, 11000],
        "11000_13000": [11000, 13000],
        "13000_plus": [13000, 100000],
      };
      const params = [`${days} days`];
      const clauses = [];
      requireEnum(args.mode, MODE_GROUPS, "mode");
      if (args.mode) {
        params.push(typesForModeGroup(args.mode));
        clauses.push(`and r.type = any($${params.length})`);
      }
      if (args.trophy_band) {
        const [lo, hi] = BANDS[args.trophy_band];
        params.push(lo, hi);
        clauses.push(
          `and r.starting_trophies >= $${params.length - 1} and r.starting_trophies < $${params.length}`,
        );
      }
      const EDGES = LEVEL_EDGES_SQL;
      const CURVE_FLOOR = PILOT_METHODOLOGY.curve_min_observations;
      const asOf = new Date();
      await ctx.db.query("begin");
      try {
        await ctx.db.query(levelPairsSql(clauses), params);
        const base = `with pairs as (select * from lv_pairs)`;
        const { rows: curveRows } = await ctx.db.query(
          `${base}
         select width_bucket(gap, ${EDGES}) as bin,
                round(min(gap), 2) as gap_lo, round(max(gap), 2) as gap_hi,
                count(*)::int as n,
                round(avg((outcome = 'win')::int)::numeric, 3) as win_rate
         from pairs group by bin order by bin`,
        );
        const curve = curveRows.map((r) => ({
          gap_range: [Number(r.gap_lo), Number(r.gap_hi)],
          n: r.n,
          win_rate: r.n >= CURVE_FLOOR ? Number(r.win_rate) : null,
          ...(r.n < CURVE_FLOOR ? { insufficient_sample: true } : {}),
        }));

        let player;
        if (focus) {
          const { rows: score } = await ctx.db.query(
            `${base},
           curve as (
             select width_bucket(gap, ${EDGES}) as bin,
                    avg((outcome = 'win')::int) as wr
             from pairs group by bin having count(*) >= ${CURVE_FLOOR})
           select count(*)::int as n,
                  round(avg(p.gap)::numeric, 2) as mean_gap,
                  round(avg((p.outcome = 'win')::int)::numeric, 3) as actual_win_rate,
                  round(avg(c.wr)::numeric, 3) as expected_from_levels,
                  round((avg((p.outcome = 'win')::int) - avg(c.wr))::numeric, 3) as pilot_score,
                  case when count(*) > 0
                       then round((0.5 / sqrt(count(*)))::numeric, 3) end as standard_error
           from pairs p
           join curve c on c.bin = width_bucket(p.gap, ${EDGES})
           where p.player_tag = $1`,
            [focus],
          );
          const { rows: trend } = await ctx.db.query(
            `${base},
           curve as (
             select width_bucket(gap, ${EDGES}) as bin,
                    avg((outcome = 'win')::int) as wr
             from pairs group by bin having count(*) >= ${CURVE_FLOOR})
           select to_char(date_trunc('month', p.battle_time), 'YYYY-MM') as month,
                  count(*)::int as n,
                  round((avg((p.outcome = 'win')::int) - avg(c.wr))::numeric, 3) as pilot_score
           from pairs p
           join curve c on c.bin = width_bucket(p.gap, ${EDGES})
           where p.player_tag = $1
           group by 1 having count(*) >= ${PILOT_METHODOLOGY.monthly_min_battles} order by 1`,
            [focus],
          );
          // Experience cohort (0024): tenure from the YearsPlayed badge;
          // percentile of pilot_score among corpus players (n >= 30 in
          // this window) in the same tenure bucket. Absent badge = tenure
          // UNKNOWN (real on old accounts too) -> no cohort claim.
          const { rows: tenure } = await ctx.db.query(
            `select years_played, account_age_days from player where player_tag = $1`,
            [focus],
          );
          const exp = tenure[0] ?? {};
          const tenureKnown =
            exp.years_played !== null && exp.years_played !== undefined;
          const experience = {
            years_played: exp.years_played ?? null,
            account_age_days: exp.account_age_days ?? null,
            tenure_known: tenureKnown,
          };
          let cohort;
          if (tenureKnown) {
            const bucket =
              exp.years_played <= 2
                ? [0, 2, "years_1_2"]
                : exp.years_played <= 5
                  ? [3, 5, "years_3_5"]
                  : [6, 99, "years_6_plus"];
            const { rows: cohortScores } = await ctx.db.query(
              `${base},
             curve as (
               select width_bucket(gap, ${EDGES}) as bin,
                      avg((outcome = 'win')::int) as wr
               from pairs group by bin having count(*) >= ${CURVE_FLOOR})
             select p.player_tag,
                    round((avg((p.outcome = 'win')::int) - avg(c.wr))::numeric, 3) as pilot
             from pairs p
             join curve c on c.bin = width_bucket(p.gap, ${EDGES})
             join player pl on pl.player_tag = p.player_tag
             where pl.years_played between $1 and $2
             group by p.player_tag having count(*) >= ${PILOT_METHODOLOGY.player_min_battles}`,
              [bucket[0], bucket[1]],
            );
            const pilots = cohortScores
              .map((r) => Number(r.pilot))
              .sort((a, z) => a - z);
            if (
              pilots.length >= 5 &&
              score[0] &&
              score[0].n >= PILOT_METHODOLOGY.player_min_battles
            ) {
              const mine = Number(score[0].pilot_score);
              const below = pilots.filter((v) => v < mine).length;
              cohort = {
                bucket: bucket[2],
                cohort_size: pilots.length,
                percentile: Number((below / pilots.length).toFixed(2)),
                cohort_median_pilot_score: Number(
                  medianSortedScores(pilots).toFixed(3),
                ),
                basis:
                  "corpus players with known tenure in the same bucket and >= 30 scored battles in this window",
              };
            } else {
              cohort = {
                bucket: bucket[2],
                cohort_size: pilots.length,
                insufficient_cohort: true,
              };
            }
          }
          const s = score[0];
          player =
            s && s.n >= PILOT_METHODOLOGY.player_min_battles
              ? {
                  player_tag: focus,
                  n: s.n,
                  mean_gap: Number(s.mean_gap),
                  actual_win_rate: Number(s.actual_win_rate),
                  expected_from_levels: Number(s.expected_from_levels),
                  pilot_score: Number(s.pilot_score),
                  standard_error: Number(s.standard_error),
                  experience,
                  ...(cohort ? { cohort } : {}),
                  monthly_trend: trend.map((t) => ({
                    month: t.month,
                    n: t.n,
                    pilot_score: Number(t.pilot_score),
                  })),
                }
              : {
                  player_tag: focus,
                  n: s?.n ?? 0,
                  experience,
                  insufficient_sample: true,
                };
        }

        await ctx.db.query("commit");
        const compact = args.verbosity === "compact";
        return {
          applied: appliedBlock({
            window: {
              from: new Date(asOf.getTime() - days * 86400_000).toISOString(),
              to: asOf.toISOString(),
              source: args.days !== undefined ? "argument" : "default",
              days,
            },
            trophy_band: args.trophy_band,
            mode: args.mode,
            verbosity: compact ? "compact" : "full",
          }),
          ...(compact ? {} : { curve }),
          ...(player ? { player } : {}),
          methodology: PILOT_METHODOLOGY,
          notes: notes(
            PILOT_NOTES,
            player && !player.experience.tenure_known
              ? "YearsPlayed badge absent, so tenure is unknown (usually an account under one year, with rare veteran exceptions) and no cohort is claimed."
              : null,
          ),
          docs: PILOT_DOCS,
          meta: responseMeta({ as_of: asOf.toISOString() }),
        };
      } catch (err) {
        await ctx.db.query("rollback").catch(() => {});
        throw err;
      }
    },
  },

  battles_compare: {
    description:
      "Side-by-side of 2-4 recorded tags (any recorded player): latest snapshot topline plus a shared performance window.",
    inputSchema: {
      type: "object",
      properties: {
        player_tags: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: 4,
          description: "Two to four player tags.",
        },
        ...WINDOW_ARGS,
      },
      required: ["player_tags"],
      additionalProperties: false,
    },
    async handler(ctx, args) {
      if ((args.player_tags ?? []).length > 4)
        throw new ToolFailure("bad_request", "battles_compare needs 2-4 tags.");
      const tags = [];
      for (const raw of args.player_tags ?? []) {
        tags.push((await subject(ctx.db, ctx.account, raw, "summary")).tag);
      }
      if (tags.length < 2)
        throw new ToolFailure("bad_request", "battles_compare needs 2-4 tags.");
      const win = resolveWindow(ctx, args);
      const { from, to } = win;
      const players = [];
      for (const tag of tags) {
        const { rows: snap } = await ctx.db.query(
          `select p.name, s.trophies, s.donations, (s.lifetime->>'battleCount')::int as battle_count,
                  (s.lifetime->>'collectionLevel')::int as collection_level
           from player p
           left join lateral (
             select * from player_snapshot_daily where player_tag = p.player_tag
             order by snapshot_date desc, snapshot_kind desc limit 1
           ) s on true where p.player_tag = $1`,
          [tag],
        );
        const params = [tag];
        const where = [
          `bp.player_tag = $1`,
          `bp.outcome in ('win','loss','draw')`,
        ];
        if (from) {
          params.push(from);
          where.push(`b.battle_time >= $${params.length}`);
        }
        if (to) {
          params.push(to);
          where.push(`b.battle_time < $${params.length}`);
        }
        const { rows: perf } = await ctx.db.query(
          `select count(*)::int battles,
                  count(*) filter (where bp.outcome = 'win')::int wins,
                  count(*) filter (where bp.outcome = 'loss')::int losses,
                  coalesce(sum(bp.trophy_change), 0)::int net_trophies
           from battle_participant bp join battle b on b.battle_id = bp.battle_id
           where ${where.join(" and ")}`,
          params,
        );
        players.push({ player_tag: tag, ...snap[0], window: perf[0] });
      }
      return {
        applied: appliedBlock({ window: win.echo, player_tags: tags }),
        players,
        notes: notes(
          "window covers RECORDED battles only, and recording start dates differ per player; net_trophies sums recorded trophy changes, not the full ladder delta.",
        ),
        docs: docsRef("recording", "completeness"),
        meta: responseMeta({
          as_of: new Date().toISOString(),
          ...(win.timezone ? { timezone_applied: win.timezone } : {}),
        }),
      };
    },
  },
};
