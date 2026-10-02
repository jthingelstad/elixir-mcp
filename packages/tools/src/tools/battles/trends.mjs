import { notBoatDefense } from "@elixir-mcp/record/boat-defense-sql";
import {
  MODE_GROUPS,
  modeGroupSql,
  eventContentSql,
  EVENT_MODE_GROUP,
  typesForModeGroup,
  responseMeta,
} from "@elixir-mcp/contracts";
import {
  MODE_SCHEMA,
  SEASON_ARG_SCHEMA,
  SEGMENT_SCHEMA,
  WINDOW_ARGS,
  appliedBlock,
  docsRef,
  notes,
  RECORDED_PLAYERS_SQL,
  populationBlock,
  requireEnum,
  resolveSeasonWindow,
  segmentFilter,
  collectionSegmentNote,
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
    // A member's own battles (boat defenses are not theirs, 0171); on the
    // corpus, the recorded players' side only: every battle has two
    // sides, so counting both makes every win rate 0.500 by construction
    // (Jamie 2026-09-25).
    const where = ["bp.outcome is not null"];
    const membership =
      seg.where ?? `bp.player_tag in (${RECORDED_PLAYERS_SQL})`;
    const win = await resolveSeasonWindow(ctx, args, {
      defaultDays: 12 * 7,
    });
    // The window starts where it was asked to (Gym #186): it used to
    // snap back to the ISO Monday, pulling in days before `from` (and
    // the end of the season before, on a season read) while echoing the
    // `from` given. The first week is marked partial instead.
    params.push(win.from);
    where.push(`${seg.timeColumn} >= $${params.length}::timestamptz`);
    if (win.to) {
      params.push(win.to);
      where.push(`${seg.timeColumn} < $${params.length}`);
    }
    requireEnum(args.mode, MODE_GROUPS, "mode");
    if (args.mode && args.mode !== EVENT_MODE_GROUP) {
      params.push(typesForModeGroup(args.mode));
      where.push(`bp.type = any($${params.length})`);
    }
    const detail = seg.where ? "bp" : "p";
    const event = eventContentSql(`${detail}.type`, "b.event_tag");
    const mode = args.mode
      ? `and ${args.mode === EVENT_MODE_GROUP ? event : `not ${event}`}`
      : "";
    // Time, player, outcome and type are covered by the window index.
    // Apply recording membership before fetching the heap-only trophies
    // and battle id. DISTINCT keys preserve multiple battles at one instant.
    const bounded = seg.where
      ? ""
      : `bounded as materialized (
      select distinct bp.player_tag, bp.battle_time
      from battle_participant bp where ${where.join(" and ")}),
      recorded as materialized (
      select bp.* from bounded bp where ${membership}),`;
    const source = seg.where ? "battle_participant" : "recorded";
    const heap = seg.where
      ? ""
      : `join battle_participant p
      on p.player_tag = bp.player_tag and p.battle_time = bp.battle_time`;
    const scope = seg.where
      ? `${where.join(" and ")} and ${membership}`
      : where.join(" and ").replaceAll("bp.", "p.");
    // Weekly, mode and distinct-player aggregates share this population.
    const { rows } = await ctx.db.query(
      `with ${bounded} selected as materialized (
         select ${detail}.player_tag, ${detail}.battle_time, ${detail}.outcome,
                ${detail}.type, ${detail}.trophy_change,
                ${modeGroupSql(`${detail}.type`, "b.event_tag")} as mode_group
           from ${source} bp ${heap}
           join battle b on b.battle_id = ${detail}.battle_id
          where ${scope} and ${notBoatDefense(detail)} ${mode}),
       by_mode as (
         select date_trunc('week', battle_time) as week_start, mode_group,
                count(*)::int as battles,
                count(*) filter (where outcome = 'win')::int as wins,
                count(*) filter (where outcome = 'loss')::int as losses
           from selected group by 1, 2),
       weekly as (
         select date_trunc('week', battle_time) as week_start,
                count(*)::int as battles,
                count(*) filter (where outcome = 'win')::int as wins,
                count(*) filter (where outcome = 'loss')::int as losses,
                count(distinct player_tag)::int as players,
                count(*) filter (where type = any($${params.length + 1}) or trophy_change is not null)::int as trophy_mode_battles,
                count(*) filter (where trophy_change is not null)::int as trophy_battles,
                coalesce(sum(trophy_change), 0)::int as net_trophies
           from selected group by 1)
       select w.*, to_char(w.week_start, 'IYYY-"W"IW') as iso_week,
              w.week_start::date::text as week_of,
              (select s.season_month from season s
                where s.starts_at <= w.week_start + interval '1 day'
                  and s.ends_at > w.week_start + interval '1 day') as season_month,
              (select count(distinct player_tag)::int from selected) as window_players,
              (select jsonb_agg(jsonb_build_object('mode_group', m.mode_group,
                        'battles', m.battles, 'wins', m.wins, 'losses', m.losses))
                 from by_mode m where m.week_start = w.week_start) as modes
         from weekly w order by w.week_start`,
      [...params, TROPHY_MODE_TYPES],
    );
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
      modes: modeSplit(r.modes ?? []),
    }));
    const { rows: weeks, partial } = markPartialWeeks(shaped, {
      from: new Date(win.from),
      to: win.to ? new Date(win.to) : null,
    });
    const population = seg.where
      ? null
      : await populationBlock(ctx.db, {
          playersInWindow: rows[0]?.window_players ?? 0,
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
        collectionSegmentNote(seg),
        seg.where
          ? null
          : "On the corpus every count reads the recorded players' side of each battle (their opponents are not counted: the two sides of a battle always sum to a 0.500 win rate), so players_in_window is recorded players who played in the window.",
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
