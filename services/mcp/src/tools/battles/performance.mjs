import { resolveInstant } from "../../time.mjs";
import {
  DISPLAY_NAME_SCHEMA,
  DUEL_TYPES,
  MODE_SCHEMA,
  ON_BEHALF_OF_SCHEMA,
  SEASON_ARG_SCHEMA,
  TAG_SCHEMA,
  ToolFailure,
  WINDOW_ARGS,
  WINDOW_FROM_DESC,
  WINDOW_TO_DESC,
  appliedBlock,
  buildMeta,
  notes,
  requireOrderedWindow,
  resolveSeasonWindow,
  subject,
} from "../shared.mjs";
import {
  TROPHY_MODE_TYPES,
  markPartialWeeks,
  partialWeeksNote,
  trophyBattlesNote,
  trophyFloor,
  trophyFloorNote,
} from "../../controls.mjs";
import { DENOMINATOR_DOCS, modeClause } from "./common.mjs";

export const battles_performance = {
  description:
    'Computed record over a window: W/L/D, win rate, crowns for/against, net trophies, three-crown rate, streaks, and trophy_floor when the player stood on an arena floor (losses there cost nothing, so net_trophies is asymmetric). compare_from/compare_to or before_after runs a second window server-side for "since X vs before" questions (before_after wins over compare_*); group_by week is the trend view (buckets the window clips are marked partial) and group_by game_mode the "what have I been playing" view.',
  inputSchema: {
    type: "object",
    properties: {
      player_tag: TAG_SCHEMA,
      on_behalf_of: ON_BEHALF_OF_SCHEMA,
      display_name: DISPLAY_NAME_SCHEMA,
      ...WINDOW_ARGS,
      season: SEASON_ARG_SCHEMA,
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
        enum: ["week", "game_mode"],
        description:
          "week: weekly series (ISO weeks). game_mode: per named game mode (the row's game_mode, not the mode group; event modes included). Overrides before_after and compare_*.",
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
        args.display_name,
      )
    ).tag;
    const win = await resolveSeasonWindow(ctx, args, {
      seasonDefault: false,
    });
    const tz = win.timezone;

    const segment = async ({ from, to, lastN }) => {
      const where = ["bp.player_tag = $1", `bp.outcome is not null`];
      const params = [tag];
      const add = (clause, value) => {
        if (!clause.includes("?")) return where.push(clause);
        params.push(value);
        where.push(clause.replace("?", `$${params.length}`));
      };
      if (from) add("bp.battle_time >= ?", from);
      if (to) add("bp.battle_time < ?", to);
      modeClause(args, add);
      if (args.deck_hash) add("bp.deck_hash = ?", args.deck_hash);
      requireOrderedWindow(from, to);
      const {
        rows: [row],
      } = await ctx.db.query(
        `with sample as materialized (
             select bp.outcome, bp.crowns, bp.trophy_change, bp.battle_time, bp.battle_id,
                    b.type_class, b.type,
                    (select max(o.crowns) from battle_participant o
                     where o.battle_id = bp.battle_id and o.side <> bp.side) as opp_crowns
             from battle_participant bp join battle b on b.battle_id = bp.battle_id
             where ${where.join(" and ")}
             order by bp.battle_time desc, bp.battle_id desc
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
    if (args.group_by === "game_mode") {
      const where = ["bp.player_tag = $1", "bp.outcome is not null"];
      const params = [tag];
      const add = (clause, value) => {
        if (!clause.includes("?")) return where.push(clause);
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
        if (!clause.includes("?")) return where.push(clause);
        params.push(value);
        where.push(clause.replace("?", `$${params.length}`));
      };
      if (from) add("bp.battle_time >= ?", from);
      if (to) add("bp.battle_time < ?", to);
      modeClause(args, add);
      if (args.deck_hash) add("bp.deck_hash = ?", args.deck_hash);
      // trophy_battles counts the rows that REPORTED a delta and a loss
      // on an arena floor reports none (feedback #61), so the trophy-mode
      // count rides beside it as the denominator for "games played".
      params.push(TROPHY_MODE_TYPES);
      const trophyModes = `$${params.length}`;
      const { rows } = await ctx.db.query(
        `select to_char(date_trunc('week', bp.battle_time), 'IYYY-"W"IW') as iso_week,
                  date_trunc('week', bp.battle_time)::date::text as week_of,
                  count(*)::int as battles,
                  count(*) filter (where bp.outcome = 'win')::int as wins,
                  count(*) filter (where bp.outcome = 'loss')::int as losses,
                  count(*) filter (where bp.outcome = 'draw')::int as draws,
                  count(*) filter (where b.type = any(${trophyModes}))::int as trophy_mode_battles,
                  count(*) filter (where bp.trophy_change is not null)::int as trophy_battles,
                  coalesce(sum(bp.trophy_change), 0)::int as net_trophies
           from battle_participant bp join battle b on b.battle_id = bp.battle_id
           where ${where.join(" and ")}
           group by date_trunc('week', bp.battle_time)
           order by date_trunc('week', bp.battle_time)`,
        params,
      );
      // A bucket the window clips is marked (feedback #60): the first
      // row of a days:30 series is usually two thirds of a week shaped
      // exactly like the whole ones, and it anchors the trend.
      const weekly = markPartialWeeks(
        rows.map((r) => ({
          iso_week: r.iso_week,
          week_of: r.week_of,
          battles: r.battles,
          wins: r.wins,
          losses: r.losses,
          draws: r.draws,
          trophy_mode_battles: r.trophy_mode_battles,
          trophy_battles: r.trophy_battles,
          net_trophies: r.net_trophies,
          win_rate:
            r.wins + r.losses > 0
              ? Number((r.wins / (r.wins + r.losses)).toFixed(3))
              : null,
        })),
        { from, to },
      );
      result = { weekly: weekly.rows };
      caveats.push(
        partialWeeksNote(weekly.partial),
        trophyBattlesNote(weekly.rows),
        "week_of is the ISO week's Monday (UTC); win_rate = wins/(wins+losses), draws excluded.",
        "net_trophies sums trophy_battles, the trophy-mode battles (ladder and Path of Legends) that reported a delta; war and event modes carry no trophies, so a rising win_rate with flat trophies usually means war-heavy weeks, and trophy_mode_battles is the count of those battles played.",
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
    // The floor under net_trophies (feedback #59): a player standing on
    // an arena's trophy floor loses nothing on a loss, so the sum counts
    // wins in full and losses at zero. Read once over the window (a
    // last_n_battles sample and the compare windows share the state).
    const floor =
      args.mode && args.mode !== "ladder"
        ? null
        : await trophyFloor(ctx.db, tag, { from, to });
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
                  resolveInstant(tz, args.compare_from)?.toISOString() ?? null,
                to:
                  resolveInstant(tz, args.compare_to, {
                    endOfDay: true,
                  })?.toISOString() ?? null,
              }
            : undefined,
      }),
      ...result,
      ...(floor ? { trophy_floor: floor } : {}),
      notes: notes(
        trophyFloorNote(floor),
        win.seasonNotes,
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
        windowTo: win.to,
      }),
    };
  },
};
