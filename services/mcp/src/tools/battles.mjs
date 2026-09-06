/** battles_query · battles_performance · battles_cards · battles_decks · battles_meta_decks · battles_meta_cards · battles_trends · battles_levels · battles_compare — moved verbatim from the
 *  single-file registry (review item 8). */

import {
  normalizeTag,
  responseMeta,
  MODE_GROUPS,
  typesForModeGroup,
} from "@elixir-mcp/contracts";
import { resolveInstant, formatLocal } from "../time.mjs";
import {
  requireEnum,
  ToolFailure,
  TAG_SCHEMA,
  subject,
  buildMeta,
  requireOrderedWindow,
  segmentFilter,
  ebShrink,
  SEGMENT_ARGS,
  SEGMENT_NOTE,
} from "./shared.mjs";

export const battlesTools = {
  battles_query: {
    description:
      "The workhorse: canonical recorded battles with filters and cursor pagination. Returns both perspectives of every battle. Three addressing modes: a player_tag (the usual sweep); battle_id alone (ONE battle, both sides - the record-browser lookup); deck_hash alone (corpus-wide battles for that exact deck, with a deck_stats aggregate - counts, W-L, distinct pilots; deliberately no win rate: a deck's pooled rate describes who plays it, see docs/META-INTEL). from/to accept ISO instants or date-only strings resolved in your timezone.",
    inputSchema: {
      type: "object",
      properties: {
        player_tag: TAG_SCHEMA,
        from: {
          type: "string",
          description: "ISO instant or YYYY-MM-DD (your timezone).",
        },
        to: {
          type: "string",
          description: "ISO instant or YYYY-MM-DD inclusive (your timezone).",
        },
        mode: {
          type: "string",
          enum: MODE_GROUPS,
          description:
            "Mode group filter. ladder = Trophy Road; ranked = Path of Legends.",
        },
        game_mode_id: { type: "integer" },
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
          description:
            "Fetch exactly this battle (both perspectives). No player_tag needed.",
        },
        game_mode: {
          type: "string",
          description:
            "Case-insensitive match on the game's mode name (substring): 'chaos' finds Chaos_1v1_Draft and friends, 'crazy' the Crazy Arena events. Discover names with battles_performance group_by: 'mode'.",
        },
        cursor: {
          type: "string",
          description:
            "Opaque pagination token from a previous response’s next_cursor.",
        },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 25 },
        include_total: {
          type: "boolean",
          description:
            "Also return total_count: how many battles match the filters across ALL pages (one cheap count query).",
        },
        verbosity: {
          type: "string",
          enum: ["full", "compact"],
          default: "full",
          description:
            "compact drops per-card deck arrays, support cards, and tower_hp (deck_hash remains) — use it for wide sweeps. full delivers both sides' decks and tower_hp and therefore caps limit at 25.",
        },
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
        );
        tag = s.tag;
      }
      const tz = ctx.account.timezone;
      const limit = Math.min(Math.max(Number(args.limit ?? 25), 1), 50);
      const compact = args.verbosity === "compact";
      // Full battles now carry BOTH sides' decks and tower_hp; above the
      // default page size that reliably overruns the result cap and
      // truncates mid-JSON. Refuse loudly instead.
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
        // deck filter added below via the shared deck_hash clause
        where.push("bp.side is not null");
      } else {
        params.push(tag);
        where.push("bp.player_tag = $1");
      }
      const add = (clause, value) => {
        params.push(value);
        where.push(clause.replace("?", `$${params.length}`));
      };
      const from = resolveInstant(tz, args.from);
      if (args.from && !from)
        throw new ToolFailure("bad_request", `Unparseable from: ${args.from}`);
      if (from) add("b.battle_time >= ?", from);
      const to = resolveInstant(tz, args.to, { endOfDay: true });
      if (args.to && !to)
        throw new ToolFailure("bad_request", `Unparseable to: ${args.to}`);
      requireOrderedWindow(from, to);
      requireEnum(args.mode, MODE_GROUPS, "mode");
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
      if (args.mode) add("b.type = any(?)", typesForModeGroup(args.mode));
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
      if (args.opponent_tag) {
        let opponent;
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
          crowns: o.crowns,
          deck_hash: o.deck_hash,
          clan_tag: o.clan_tag,
          // Full verbosity delivers the promised "both perspectives":
          // participant rows are written symmetrically at ingest.
          ...(compact ? {} : { deck: o.deck, tower_hp: o.tower_hp }),
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
            ...(compact
              ? {}
              : {
                  deck: r.deck,
                  elixir_leaked:
                    r.elixir_leaked === null ? null : Number(r.elixir_leaked),
                  tower_hp: r.tower_hp,
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
      let warnings;
      if (battles.length === 0 && to && tag) {
        const { rows: firstRec } = await ctx.db.query(
          `select min(battle_time) as first from battle_participant where player_tag = $1`,
          [tag],
        );
        const first = firstRec[0]?.first;
        if (first && to.getTime() < first.getTime()) {
          warnings = [
            `window_precedes_recording: the window ends before this player's first recorded battle (${first.toISOString()}); emptiness means no COVERAGE, not inactivity.`,
          ];
        }
      }

      return {
        ...(tag ? { player_tag: tag } : {}),
        ...(byBattle ? { battle_id: String(args.battle_id) } : {}),
        ...(deckStats
          ? {
              deck_hash: String(args.deck_hash),
              deck_stats: deckStats,
              deck_note:
                "No pooled win rate by design: a deck's rate describes who plays it. Ask battles_meta_decks for shrunk rates with sample sizes.",
            }
          : {}),
        battles,
        // The clamp was silent (adversarial pass, 2026-09-06): agents
        // asking for 10000 got 50 rows that looked like everything.
        limit_applied: limit,
        ...(warnings ? { warnings } : {}),
        ...(totalCount !== undefined ? { total_count: totalCount } : {}),
        // Explicit null = end of results (absent-vs-null was ambiguous).
        next_cursor:
          rows.length === limit
            ? `${rows[rows.length - 1].battle_time.toISOString()}|${rows[rows.length - 1].battle_id}`
            : null,
        ...(compact
          ? {}
          : {
              card_legend:
                "Deck cards: level is the in-game 1-16 scale; evolutionLevel discriminates the FORM the card took in this battle (1 = Evolution, 2 = Hero; absent = base) — never a level; starLevel is cosmetic. tower_hp is the hitpoints REMAINING on that player's towers when the battle ended (a margin signal, never a level); princess is an array of surviving princess-tower hp, and null means the game did not report tower data for this battle.",
            }),
        meta: await buildMeta(
          ctx.db,
          ctx.account,
          tag ?? rows[0]?.player_tag ?? "#",
        ),
      };
    },
  },
  battles_performance: {
    description:
      'Computed record over a window: W/L/D, win rate, crowns for/against, net trophies, three-crown rate, streaks. compare_from/compare_to or before_after runs a second window server-side — built for "since X vs before" questions. Precedence: before_after wins over compare_*; the response echoes filters_applied.',
    inputSchema: {
      type: "object",
      properties: {
        player_tag: TAG_SCHEMA,
        from: {
          type: "string",
          description: "ISO instant or YYYY-MM-DD (your timezone).",
        },
        to: { type: "string" },
        last_n_battles: { type: "integer", minimum: 1, maximum: 500 },
        mode: { type: "string", enum: MODE_GROUPS },
        deck_hash: { type: "string" },
        compare_from: { type: "string" },
        compare_to: { type: "string" },
        group_by: {
          type: "string",
          enum: ["week", "mode"],
          description:
            "week: weekly win-rate series (ISO weeks) — the trend view. mode: per-game-mode record (every named mode played — Ladder, Ranked, war modes, and event modes like Chaos/KHAOS drafts or Crazy Arena — the 'what have I been playing?' discovery view). Combines with mode/deck_hash/from/to; overrides before_after and compare_*.",
        },
        before_after: {
          type: "string",
          description:
            "Date splitting two windows: [from..date) vs [date..to] — e.g. performance before vs after a deck change.",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const tag = (
        await subject(ctx.db, ctx.account, args.player_tag, "summary")
      ).tag;
      const tz = ctx.account.timezone;

      const segment = async ({ from, to, lastN }) => {
        const where = ["bp.player_tag = $1", `bp.outcome is not null`];
        const params = [tag];
        const add = (clause, value) => {
          params.push(value);
          where.push(clause.replace("?", `$${params.length}`));
        };
        if (from) add("b.battle_time >= ?", from);
        if (to) add("b.battle_time < ?", to);
        requireEnum(args.mode, MODE_GROUPS, "mode");
        if (args.mode) add("b.type = any(?)", typesForModeGroup(args.mode));
        if (args.deck_hash) add("bp.deck_hash = ?", args.deck_hash);
        const { rows } = await ctx.db.query(
          `select bp.outcome, bp.crowns, bp.trophy_change,
                  (select max(o.crowns) from battle_participant o
                   where o.battle_id = bp.battle_id and o.side <> bp.side) as opp_crowns
           from battle_participant bp join battle b on b.battle_id = bp.battle_id
           where ${where.join(" and ")}
           order by b.battle_time desc
           ${lastN ? `limit ${Math.min(lastN, 500)}` : "limit 2000"}`,
          params,
        );
        const wins = rows.filter((r) => r.outcome === "win").length;
        const losses = rows.filter((r) => r.outcome === "loss").length;
        const draws = rows.filter((r) => r.outcome === "draw").length;
        const decided = wins + losses;
        let streak = 0;
        for (const r of rows) {
          if (r.outcome === "unresolved" || r.outcome === "draw") continue;
          if (streak === 0) streak = r.outcome === "win" ? 1 : -1;
          else if (streak > 0 && r.outcome === "win") streak += 1;
          else if (streak < 0 && r.outcome === "loss") streak -= 1;
          else break;
        }
        return {
          battles: rows.length,
          wins,
          losses,
          draws,
          win_rate: decided > 0 ? Number((wins / decided).toFixed(3)) : null,
          crowns_for: rows.reduce((s, r) => s + (r.crowns ?? 0), 0),
          crowns_against: rows.reduce((s, r) => s + (r.opp_crowns ?? 0), 0),
          net_trophies: rows.reduce((s, r) => s + (r.trophy_change ?? 0), 0),
          three_crown_rate:
            rows.length > 0
              ? Number(
                  (
                    rows.filter((r) => r.crowns === 3).length / rows.length
                  ).toFixed(3),
                )
              : null,
          current_streak: streak,
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
      const from = resolveInstant(tz, args.from);
      const to = resolveInstant(tz, args.to, { endOfDay: true });
      requireOrderedWindow(from, to);
      let result;
      if (args.group_by === "mode") {
        const where = ["bp.player_tag = $1", "bp.outcome is not null"];
        const params = [tag];
        const add = (clause, value) => {
          params.push(value);
          where.push(clause.replace("?", `$${params.length}`));
        };
        if (from) add("bp.battle_time >= ?", from);
        if (to) add("bp.battle_time < ?", to);
        requireEnum(args.mode, MODE_GROUPS, "mode");
        if (args.mode) add("b.type = any(?)", typesForModeGroup(args.mode));
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
          mode_note:
            "game_mode is the game's own mode name (event modes rotate - Chaos drafts, Crazy Arena, Showdown and so on appear here the day they are played); type is the API battle type it rode in on. Filter battles_query by game_mode to drill into any of them.",
        };
      } else if (args.group_by === "week") {
        const where = ["bp.player_tag = $1", "bp.outcome is not null"];
        const params = [tag];
        const add = (clause, value) => {
          params.push(value);
          where.push(clause.replace("?", `$${params.length}`));
        };
        if (from) add("bp.battle_time >= ?", from);
        if (to) add("bp.battle_time < ?", to);
        requireEnum(args.mode, MODE_GROUPS, "mode");
        if (args.mode) add("b.type = any(?)", typesForModeGroup(args.mode));
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
          weekly_note:
            "week_of is the ISO week's Monday (UTC). win_rate = wins/(wins+losses), draws excluded. net_trophies covers only trophy_battles (war and special modes carry no trophies) — a rising win_rate with flat trophies usually means war-heavy weeks.",
          ...(args.before_after || args.compare_from || args.compare_to
            ? {
                note: "group_by week takes precedence; before_after/compare_* were ignored.",
              }
            : {}),
        };
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
          // Precedence made visible (edge-poker: silent resolution
          // means trusting wrong numbers).
          ...(args.compare_from || args.compare_to
            ? {
                note: "before_after takes precedence; compare_from/compare_to were ignored.",
              }
            : {}),
        };
      } else if (args.compare_from || args.compare_to) {
        result = {
          window: await segment({ from, to, lastN: args.last_n_battles }),
          compare_window: await segment({
            from: resolveInstant(tz, args.compare_from),
            to: resolveInstant(tz, args.compare_to, { endOfDay: true }),
          }),
        };
      } else {
        result = {
          window: await segment({ from, to, lastN: args.last_n_battles }),
        };
      }
      return {
        player_tag: tag,
        // Echo of everything applied, so results are attributable
        // (deck-tinkerer: could not verify which filters were live).
        filters_applied: {
          ...(args.mode ? { mode: args.mode } : {}),
          ...(args.deck_hash ? { deck_hash: args.deck_hash } : {}),
          ...(from ? { from: from.toISOString() } : {}),
          ...(to ? { to: to.toISOString() } : {}),
          ...(args.last_n_battles && !args.before_after
            ? { last_n_battles: args.last_n_battles }
            : {}),
        },
        ...result,
        meta: await buildMeta(ctx.db, ctx.account, tag),
      };
    },
  },

  battles_cards: {
    description:
      'Per-card win/loss attribution over recorded battles. perspective "mine": which of your cards carry. perspective "opponent": which enemy cards beat you — the nemesis question. Duels are excluded (no single deck).',
    inputSchema: {
      type: "object",
      properties: {
        player_tag: TAG_SCHEMA,
        perspective: {
          type: "string",
          enum: ["mine", "opponent"],
          default: "mine",
        },
        from: { type: "string" },
        to: { type: "string" },
        mode: { type: "string", enum: MODE_GROUPS },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const tag = (
        await subject(ctx.db, ctx.account, args.player_tag, "summary")
      ).tag;
      const tz = ctx.account.timezone;
      const mine = args.perspective !== "opponent";
      const where = ["bp.player_tag = $1", `bp.outcome in ('win','loss')`];
      const params = [tag];
      const add = (clause, value) => {
        params.push(value);
        where.push(clause.replace("?", `$${params.length}`));
      };
      const from = resolveInstant(tz, args.from);
      if (from) add("b.battle_time >= ?", from);
      const to = resolveInstant(tz, args.to, { endOfDay: true });
      if (to) add("b.battle_time < ?", to);
      requireEnum(args.mode, MODE_GROUPS, "mode");
      if (args.mode) add("b.type = any(?)", typesForModeGroup(args.mode));

      const deckSource = mine
        ? `bp.deck`
        : `(select o.deck from battle_participant o
            where o.battle_id = bp.battle_id and o.side <> bp.side and o.deck is not null
            limit 1)`;
      const { rows } = await ctx.db.query(
        `select card->>'name' as name, (card->>'id')::bigint as id,
                count(*) filter (where bp.outcome = 'win')::int as wins,
                count(*) filter (where bp.outcome = 'loss')::int as losses
         from battle_participant bp
         join battle b on b.battle_id = bp.battle_id,
         lateral jsonb_array_elements(coalesce(${deckSource}->'cards', '[]'::jsonb)) card
         where ${where.join(" and ")}
         group by 1, 2
         having count(*) >= 3
         order by count(*) desc
         limit 120`,
        params,
      );
      return {
        player_tag: tag,
        perspective: mine ? "mine" : "opponent",
        cards: rows.map((r) => ({
          id: Number(r.id),
          name: r.name,
          battles: r.wins + r.losses,
          wins: r.wins,
          losses: r.losses,
          win_rate: Number((r.wins / (r.wins + r.losses)).toFixed(3)),
        })),
        note: mine
          ? "win_rate is YOUR record when this card is in your deck."
          : "win_rate is YOUR record when this card appears in the OPPONENT deck — low means nemesis.",
        meta: await buildMeta(ctx.db, ctx.account, tag),
      };
    },
  },

  battles_decks: {
    description:
      "Battles grouped by exact deck identity (deck_hash): per-deck record, first/last used, win rate. Some special modes field more or fewer than 8 cards — deck identity is always the exact card set played. The factual substrate for deck review — pass a deck_hash to battles_query or battles_performance to drill in.",
    inputSchema: {
      type: "object",
      properties: {
        player_tag: TAG_SCHEMA,
        from: { type: "string" },
        to: { type: "string" },
        mode: { type: "string", enum: MODE_GROUPS },
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
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const tag = (
        await subject(ctx.db, ctx.account, args.player_tag, "summary")
      ).tag;
      const tz = ctx.account.timezone;
      const where = ["bp.player_tag = $1", "bp.deck_hash is not null"];
      const params = [tag];
      const add = (clause, value) => {
        params.push(value);
        where.push(clause.replace("?", `$${params.length}`));
      };
      const from = resolveInstant(tz, args.from);
      if (from) add("b.battle_time >= ?", from);
      const to = resolveInstant(tz, args.to, { endOfDay: true });
      if (to) add("b.battle_time < ?", to);
      requireEnum(args.mode, MODE_GROUPS, "mode");
      if (args.mode) add("b.type = any(?)", typesForModeGroup(args.mode));
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
      shaped = shaped.slice(0, 40);
      return {
        player_tag: tag,
        total_battles_in_window: totalBattles,
        decks: shaped.map((r) => ({
          deck_hash: r.deck_hash,
          cards: (r.deck?.cards ?? []).map((c) => ({ id: c.id, name: c.name })),
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
        meta: await buildMeta(ctx.db, ctx.account, tag),
      };
    },
  },

  battles_meta_decks: {
    description:
      "Observed deck meta for a segment - the whole corpus, one clan, one player, or a collection like 'pros'. Per exact deck identity (deck_hash): battles, record, distinct players, usage share, raw and EB-shrunk win rates. No tier lists, no opinions - what the recorded data shows, with sample sizes.",
    inputSchema: {
      type: "object",
      properties: {
        ...SEGMENT_ARGS,
        from: { type: "string", description: "Default: 28 days ago." },
        to: { type: "string" },
        mode: { type: "string", enum: MODE_GROUPS },
        min_battles: { type: "integer", minimum: 1, default: 5 },
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
      const tz = ctx.account.timezone;
      const params = [];
      const seg = await segmentFilter(ctx, args, params);
      const where = ["bp.deck_hash is not null", "bp.outcome is not null"];
      if (seg.where) where.push(seg.where);
      const from =
        resolveInstant(tz, args.from) ??
        new Date(Date.now() - 28 * 86400_000).toISOString();
      params.push(from);
      where.push(`b.battle_time >= $${params.length}`);
      const to = resolveInstant(tz, args.to, { endOfDay: true });
      if (to) {
        params.push(to);
        where.push(`b.battle_time < $${params.length}`);
      }
      if (args.mode) {
        params.push(typesForModeGroup(args.mode));
        where.push(`b.type = any($${params.length})`);
      }
      requireOrderedWindow(new Date(from), to ? new Date(to) : null);
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
      const minBattles = args.min_battles ?? 5;
      let shaped = rows
        .filter((r) => r.battles >= minBattles)
        .map((r) => ({
          deck_hash: r.deck_hash,
          cards: (r.deck?.cards ?? []).map((c) => ({
            id: c.id,
            name: c.name,
          })),
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
          shrunk_win_rate: ebShrink(r.wins, r.wins + r.losses, mean),
          first_used: r.first_used.toISOString(),
          last_used: r.last_used.toISOString(),
        }));
      const sort = args.sort ?? "battles";
      shaped.sort((a, z) =>
        sort === "shrunk_win_rate"
          ? z.shrunk_win_rate - a.shrunk_win_rate
          : sort === "players"
            ? z.players - a.players
            : z.battles - a.battles,
      );
      shaped = shaped.slice(0, Math.min(args.limit ?? 20, 40));
      return {
        segment: seg.label,
        window_from: from,
        decided_battles: totalDecided,
        segment_win_rate: Number(mean.toFixed(3)),
        decks: shaped,
        note: SEGMENT_NOTE,
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  battles_meta_cards: {
    description:
      "Observed card meta for a segment - corpus, clan, player, or a collection like 'pros'. Per card AND evolution form (forms never merge): usage share among decided battles, distinct players, raw and EB-shrunk win rates. What the recorded data shows, with sample sizes - never a tier list.",
    inputSchema: {
      type: "object",
      properties: {
        ...SEGMENT_ARGS,
        from: { type: "string", description: "Default: 28 days ago." },
        to: { type: "string" },
        mode: { type: "string", enum: MODE_GROUPS },
        min_battles: { type: "integer", minimum: 1, default: 10 },
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
      const tz = ctx.account.timezone;
      const params = [];
      const seg = await segmentFilter(ctx, args, params);
      const where = ["bp.deck ? 'cards'", "bp.outcome is not null"];
      if (seg.where) where.push(seg.where);
      const from =
        resolveInstant(tz, args.from) ??
        new Date(Date.now() - 28 * 86400_000).toISOString();
      params.push(from);
      where.push(`b.battle_time >= $${params.length}`);
      const to = resolveInstant(tz, args.to, { endOfDay: true });
      if (to) {
        params.push(to);
        where.push(`b.battle_time < $${params.length}`);
      }
      if (args.mode) {
        params.push(typesForModeGroup(args.mode));
        where.push(`b.type = any($${params.length})`);
      }
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
          shrunk_win_rate: ebShrink(r.wins, r.wins + r.losses, mean),
        }));
      const sort = args.sort ?? "usage";
      shaped.sort((a, z) =>
        sort === "shrunk_win_rate"
          ? z.shrunk_win_rate - a.shrunk_win_rate
          : z.battles - a.battles,
      );
      shaped = shaped.slice(0, Math.min(args.limit ?? 30, 130));
      return {
        segment: seg.label,
        window_from: from,
        decided_battles: totalDecided,
        segment_win_rate: Number(mean.toFixed(3)),
        cards: shaped,
        note:
          SEGMENT_NOTE +
          " evolution distinguishes card FORM (1 = Evolution, 2 = Hero form) - the same card's forms are different rows by design. Card win rates are heavily skill-confounded (who plays it matters as much as the card): compare shrunk rates within similar usage, never across segments.",
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  battles_trends: {
    description:
      "Weekly time series for a segment - corpus, clan, player, or a collection like 'pros': battles, record, aggregate win rate, distinct active players, net trophies per ISO week. The trend view of any group; single-player weekly detail also lives in battles_performance group_by 'week'.",
    inputSchema: {
      type: "object",
      properties: {
        ...SEGMENT_ARGS,
        weeks: { type: "integer", minimum: 1, maximum: 52, default: 12 },
        mode: { type: "string", enum: MODE_GROUPS },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const params = [];
      const seg = await segmentFilter(ctx, args, params);
      const where = ["bp.outcome is not null"];
      if (seg.where) where.push(seg.where);
      const weeks = Math.min(Math.max(Number(args.weeks ?? 12), 1), 52);
      params.push(`${weeks * 7} days`);
      where.push(
        `b.battle_time >= date_trunc('week', now()) - $${params.length}::interval`,
      );
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
        segment: seg.label,
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
        note: "Aggregate win_rate over a group moves with COMPOSITION (who played that week) as much as with skill - players per week is the tell. Recording start dates differ per player; early weeks may be thin because capture was, not because play was.",
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  battles_levels: {
    description:
      'The Level Curve and Pilot Score (META-INTEL §9): how much card-level advantage is worth, measured — win rate by deck-average level gap across the recorded corpus, binned where the data lives, never extrapolated. Pass player_tag for their Pilot Score: actual minus level-expected win rate ("wins your card levels can\'t explain") with a monthly trend — a CLIMBING trend is "getting better" independent of spending. Numbers with receipts: every bin and score ships its sample size.',
    inputSchema: {
      type: "object",
      properties: {
        player_tag: {
          type: "string",
          description:
            "Optional: score this player against the curve (Pilot Score + monthly trend).",
        },
        days: {
          type: "integer",
          minimum: 7,
          maximum: 365,
          default: 90,
          description: "Window for the curve and score.",
        },
        mode: { type: "string", enum: MODE_GROUPS },
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
            "Condition the curve on the perspective player's starting trophies. An even-level match at 13k is a harder population than one at 6k.",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const days = Number(args.days ?? 90);
      if (!Number.isInteger(days) || days < 7 || days > 365)
        throw new ToolFailure("bad_request", "days must be 7-365.");
      let focus = null;
      if (args.player_tag !== undefined)
        focus = (await subject(ctx.db, ctx.account, args.player_tag, "summary"))
          .tag;
      const BANDS = {
        under_5000: [0, 5000],
        "5000_8000": [5000, 8000],
        "8000_11000": [8000, 11000],
        "11000_13000": [11000, 13000],
        "13000_plus": [13000, 100000],
      };
      const params = [`${days} days`];
      const clauses = [];
      if (args.mode) {
        params.push(typesForModeGroup(args.mode));
        clauses.push(`and b.type = any($${params.length})`);
      }
      if (args.trophy_band) {
        const [lo, hi] = BANDS[args.trophy_band];
        params.push(lo, hi);
        clauses.push(
          `and bp.starting_trophies >= $${params.length - 1} and bp.starting_trophies < $${params.length}`,
        );
      }
      const EDGES =
        "array[-2.5,-1.5,-1.0,-0.6,-0.3,-0.1,0.1,0.3,0.6,1.0,1.5,2.5]";
      const CURVE_FLOOR = 200;
      // The pairs set is expensive (jsonb lateral over every deck); build
      // it ONCE per request - curve, score, trend, and cohort all read it.
      // Temp table is session-local; the txn drops it.
      await ctx.db.query("begin");
      try {
        await ctx.db.query(
          `create temp table lv_pairs on commit drop as
         with sides as (
           select bp.battle_id, bp.player_tag, bp.outcome, b.battle_time,
                  avg((c.value->>'level')::numeric) as lvl
           from battle_participant bp
           join battle b on b.battle_id = bp.battle_id
           cross join lateral jsonb_array_elements(bp.deck->'cards') c
           where bp.deck ? 'cards' and b.type_class = 'pvp'
             and bp.outcome in ('win','loss')
             and b.battle_time > now() - $1::interval
             ${clauses.join(" ")}
           group by bp.battle_id, bp.player_tag, bp.outcome, b.battle_time),
         duos as (select battle_id from sides group by battle_id having count(*) = 2)
         select a.battle_id, a.player_tag, a.outcome, a.battle_time,
                a.lvl - o.lvl as gap
         from sides a
         join sides o on o.battle_id = a.battle_id and o.player_tag <> a.player_tag
         where a.battle_id in (select battle_id from duos)`,
          params,
        );
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
           group by 1 having count(*) >= 20 order by 1`,
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
          const experience = {
            years_played: exp.years_played ?? null,
            account_age_days: exp.account_age_days ?? null,
            ...(exp.years_played === null || exp.years_played === undefined
              ? {
                  note: "YearsPlayed badge absent - tenure unknown. Usually this means an account under 1 year (the badge appears at year one), but rare veteran exceptions exist (measured: accounts with 2024 event badges and no YearsPlayed), so null is served rather than 0.",
                }
              : {}),
          };
          let cohort;
          if (exp.years_played !== null && exp.years_played !== undefined) {
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
             group by p.player_tag having count(*) >= 30`,
              [bucket[0], bucket[1]],
            );
            const pilots = cohortScores
              .map((r) => Number(r.pilot))
              .sort((a, z) => a - z);
            if (pilots.length >= 5 && score[0] && score[0].n >= 30) {
              const mine = Number(score[0].pilot_score);
              const below = pilots.filter((v) => v < mine).length;
              cohort = {
                bucket: bucket[2],
                cohort_size: pilots.length,
                percentile: Number((below / pilots.length).toFixed(2)),
                cohort_median_pilot_score: Number(
                  pilots[Math.floor(pilots.length / 2)].toFixed(3),
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
            s && s.n >= 30
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
        return {
          window_days: days,
          ...(args.trophy_band ? { trophy_band: args.trophy_band } : {}),
          ...(args.mode ? { mode: args.mode } : {}),
          ...(args.include_curve === false ? {} : { curve }),
          ...(player ? { player } : {}),
          note: "The curve measures the WITHIN-MATCH value of level advantage (each battle contributes both perspectives, so it is symmetric by construction); it does not measure the positional effect of upgrades on where you sit in matchmaking. pilot_score = actual minus level-expected win rate — wins your card levels can't explain. It embeds experience and opposition strength: compare your own TREND over months, or players of similar tenure and band, not raw scores across different careers. Bins below floor serve counts only — no extrapolation.",
          meta: responseMeta({ as_of: new Date().toISOString() }),
        };
      } catch (err) {
        await ctx.db.query("rollback").catch(() => {});
        throw err;
      }
    },
  },

  battles_compare: {
    description:
      "Side-by-side of 2-4 recorded tags (any player the service records - universal reads): latest snapshot topline plus a shared performance window.",
    inputSchema: {
      type: "object",
      properties: {
        player_tags: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: 4,
        },
        from: {
          type: "string",
          description: "ISO instant or YYYY-MM-DD (your timezone).",
        },
        to: { type: "string" },
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
      const tz = ctx.account.timezone;
      const from = resolveInstant(tz, args.from);
      const to = resolveInstant(tz, args.to, { endOfDay: true });
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
        players,
        note: "window covers RECORDED battles only; net_trophies sums trophy changes across those battles, not the players' full ladder delta — recording start dates differ per player.",
        meta: responseMeta({
          as_of: new Date().toISOString(),
          ...(tz ? { timezone_applied: tz } : {}),
        }),
      };
    },
  },
};
