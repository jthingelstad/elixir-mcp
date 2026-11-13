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
  ToolFailure,
  appliedBlock,
  docsRef,
  notes,
  requireEnum,
  resolveSeasonWindow,
  segmentFilter,
  clanSegmentNote,
} from "../shared.mjs";
import {
  TROPHY_MODE_TYPES,
  markPartialWeeks,
  modeSplit,
  partialWeeksNote,
  trophyBattlesNote,
} from "../../controls.mjs";

/** Arguments that name one player's own sample, or a second window; a
 *  population's weekly series takes none of them (12.0.0: battles_trends
 *  folded into battles_performance as `segment`). Refused, never ignored,
 *  so an agent never reads a population where it meant one player. */
const NOT_WITH_SEGMENT = [
  "player_tag",
  "on_behalf_of",
  "display_name",
  "last_n_battles",
  "deck_hash",
  "compare_from",
  "compare_to",
  "before_after",
];

/** battles_performance with `segment`: a named population's weekly series,
 *  as battles_trends served it until 12.0.0 (same rows, same notes). */
export async function performanceSegment(ctx, args) {
  const named = NOT_WITH_SEGMENT.filter((k) => args[k] !== undefined);
  if (named.length > 0)
    throw new ToolFailure(
      "bad_request",
      `segment reads a population's weekly series and takes no ${named.join(", ")}.`,
      "For one player's own record, omit segment and pass player_tag; for a player's weekly series either works: segment { player_tag } or group_by 'week'.",
    );
  if (args.group_by !== undefined && args.group_by !== "week")
    throw new ToolFailure(
      "bad_request",
      `segment reads weekly; group_by '${args.group_by}' is one player's view.`,
      "Omit group_by (segment is weekly), or omit segment and pass player_tag for group_by 'game_mode'.",
    );
  if (args.weeks !== undefined && args.weeks > 52)
    throw new ToolFailure(
      "bad_request",
      `weeks with segment is at most 52 (got ${args.weeks}).`,
      "Pass weeks from 1 to 52, or from/to.",
    );
  const params = [];
  const seg = await segmentFilter(ctx, args, params);
  const where = ["bp.outcome is not null"];
  const membership = seg.where;
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
  const detail = "bp";
  const event = eventContentSql("bp.type", "b.event_tag");
  const mode = args.mode
    ? `and ${args.mode === EVENT_MODE_GROUP ? event : `not ${event}`}`
    : "";
  const scope = `${where.join(" and ")} and ${membership}`;
  // Weekly, mode and distinct-player aggregates share this population.
  const { rows } = await ctx.db.query(
    `with selected as materialized (
         select ${detail}.player_tag, ${detail}.battle_time, ${detail}.outcome,
                ${detail}.type, ${detail}.trophy_change,
                ${modeGroupSql(`${detail}.type`, "b.event_tag")} as mode_group
           from battle_participant bp
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
  return {
    applied: appliedBlock({
      segment: seg.echo,
      window: win.echo,
      group_by: "week",
      weeks: args.weeks,
      mode: args.mode,
    }),
    weeks,
    notes: notes(
      clanSegmentNote(seg),
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
    docs: docsRef("freshness-and-gaps", "completeness"),
    meta: responseMeta({
      as_of: new Date().toISOString(),
      ...(win.timezone ? { timezone_applied: win.timezone } : {}),
    }),
  };
}
