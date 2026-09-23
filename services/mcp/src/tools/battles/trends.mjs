import {
  MODE_GROUPS,
  responseMeta,
  typesForModeGroup,
} from "@elixir-mcp/contracts";
import {
  MODE_SCHEMA,
  SEASON_ARG_SCHEMA,
  SEGMENT_SCHEMA,
  WINDOW_ARGS,
  appliedBlock,
  docsRef,
  notes,
  populationBlock,
  requireEnum,
  resolveSeasonWindow,
  segmentFilter,
} from "../shared.mjs";
import {
  TROPHY_MODE_TYPES,
  markPartialWeeks,
  modeSplit,
  partialWeeksNote,
  trophyBattlesNote,
} from "../../controls.mjs";

export const battles_trends = {
  description:
    "Weekly time series for a named population: segment 'mine', 'corpus' or {clan_tag | player_tag | collection}. Per ISO week: battles, record, aggregate win rate, distinct active players, net trophies, the season the week starts in. Default 12 weeks; weeks, from/to or season set the window; applied.window.crosses marks each season roll inside it. Single-player weekly detail also lives in battles_performance group_by 'week'.",
  inputSchema: {
    type: "object",
    properties: {
      segment: SEGMENT_SCHEMA,
      ...WINDOW_ARGS,
      weeks: {
        type: "integer",
        minimum: 1,
        maximum: 52,
        description: "How many ISO weeks back (default 12); or use from/to.",
      },
      season: SEASON_ARG_SCHEMA,
      mode: MODE_SCHEMA,
    },
    required: ["segment"],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const params = [];
    const seg = await segmentFilter(ctx, args, params);
    const where = ["bp.outcome is not null"];
    if (seg.where) where.push(seg.where);
    const win = await resolveSeasonWindow(ctx, args, {
      defaultDays: 12 * 7,
    });
    // Weeks are aligned: the window's start snaps to its ISO Monday so
    // the first row is a whole week.
    params.push(win.from);
    where.push(
      `${seg.timeColumn} >= date_trunc('week', $${params.length}::timestamptz)`,
    );
    if (win.to) {
      params.push(win.to);
      where.push(`${seg.timeColumn} < $${params.length}`);
    }
    requireEnum(args.mode, MODE_GROUPS, "mode");
    if (args.mode) {
      params.push(typesForModeGroup(args.mode));
      where.push(`bp.type = any($${params.length})`);
    }
    const { rows } = await ctx.db.query(
      `select w.*,
                (select s.season_month from season s
                  where s.starts_at <= w.week_start + interval '1 day'
                    and s.ends_at > w.week_start + interval '1 day') as season_month
         from (
           select date_trunc('week', bp.battle_time) as week_start,
                  to_char(date_trunc('week', bp.battle_time), 'IYYY-"W"IW') as iso_week,
                  date_trunc('week', bp.battle_time)::date::text as week_of,
                  count(*)::int as battles,
                  count(*) filter (where bp.outcome = 'win')::int as wins,
                  count(*) filter (where bp.outcome = 'loss')::int as losses,
                  count(distinct bp.player_tag)::int as players,
                  count(*) filter (where bp.type = any($${params.length + 1}))::int as trophy_mode_battles,
                  count(*) filter (where bp.trophy_change is not null)::int as trophy_battles,
                  coalesce(sum(bp.trophy_change), 0)::int as net_trophies
           from battle_participant bp
           where ${where.join(" and ")}
           group by date_trunc('week', bp.battle_time)) w
         order by w.week_start`,
      [...params, TROPHY_MODE_TYPES],
    );
    // The control next to the number (3.16.0): the week's mode split
    // (one more group-by over the same rows), and the buckets the
    // window clips marked with the span they hold.
    const { rows: byType } = await ctx.db.query(
      `select date_trunc('week', bp.battle_time)::date::text as week_of, bp.type,
                count(*)::int as battles,
                count(*) filter (where bp.outcome = 'win')::int as wins,
                count(*) filter (where bp.outcome = 'loss')::int as losses,
                (select count(distinct bp2.player_tag)::int
                   from battle_participant bp2
                  where ${where.join(" and ").replaceAll("bp.", "bp2.")}) as window_players
           from battle_participant bp
          where ${where.join(" and ")}
          group by 1, 2`,
      params,
    );
    const typesByWeek = new Map();
    for (const t of byType) {
      if (!typesByWeek.has(t.week_of)) typesByWeek.set(t.week_of, []);
      typesByWeek.get(t.week_of).push(t);
    }
    const shaped = rows.map((r) => ({
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
      trophy_mode_battles: r.trophy_mode_battles,
      trophy_battles: r.trophy_battles,
      net_trophies: r.net_trophies,
      season_month: r.season_month,
      modes: modeSplit(typesByWeek.get(r.week_of) ?? []),
    }));
    const { rows: weeks, partial } = markPartialWeeks(shaped, {
      from: null,
      to: win.to ? new Date(win.to) : null,
    });
    const population = seg.where
      ? null
      : await populationBlock(ctx.db, {
          playersInWindow: byType[0]?.window_players ?? 0,
        });
    return {
      applied: appliedBlock({
        segment: seg.echo,
        window: win.echo,
        weeks: args.weeks,
        mode: args.mode,
      }),
      ...(population ? { population } : {}),
      weeks,
      notes: notes(
        partialWeeksNote(partial),
        trophyBattlesNote(weeks),
        "Aggregate win_rate over a group moves with COMPOSITION (who played that week) as much as with skill; players per week is the tell.",
        !args.mode && weeks.some((w) => Object.keys(w.modes).length > 1)
          ? "Weeks pool every mode group (modes says which); matchmaking differs by mode, so pass mode before reading win_rate as a trend of strength."
          : null,
        "season_month is the season the week's Tuesday to Sunday fall in; a season rolls on Monday at 10:00 UTC, so a roll week's first hours belong to the season before (applied.window.crosses says where).",
        win.seasonNotes,
        "Recording start dates differ per player, so early weeks may be thin because capture was, not because play was.",
      ),
      docs: docsRef("recording", "completeness"),
      meta: responseMeta({
        as_of: new Date().toISOString(),
        ...(win.timezone ? { timezone_applied: win.timezone } : {}),
      }),
    };
  },
};
