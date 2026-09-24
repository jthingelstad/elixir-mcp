import { resolveInstant } from "../../time.mjs";
import {
  ToolFailure,
  WINDOW_ARGS,
  appliedBlock,
  buildMeta,
  docsRef,
  notes,
  requireOrderedWindow,
  seasonFieldsForInstants,
  withWindowSugar,
  zoneFor,
} from "../shared.mjs";
import { AS_OF_SCHEMA, seasonStartOf } from "./common.mjs";

export const game_events = {
  description:
    "What was ON: the in-game events (modes, challenges, side modes) the API listed as running, recorded from daily sightings (sparser before 2026-09-11) with the days each was seen. The API shows only today's and gives no dates, so this is the season's calendar built from sightings - the thing that explains a spike of some mode in a battle log. Default window: the current season so far.",
  inputSchema: {
    type: "object",
    properties: {
      ...WINDOW_ARGS,
      limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
    },
    additionalProperties: false,
  },
  async handler(ctx, rawArgs) {
    const args = withWindowSugar(rawArgs);
    const tz = zoneFor(ctx, args);
    const to =
      args.to !== undefined
        ? resolveInstant(tz, args.to, { endOfDay: true })
        : new Date();
    const from =
      args.from !== undefined
        ? resolveInstant(tz, args.from)
        : new Date(seasonStartOf(to));
    if (!from || !to)
      throw new ToolFailure(
        "bad_request",
        "Could not read from/to as dates.",
        AS_OF_SCHEMA.description,
      );
    // An inverted window is refused, as the battle tools refuse it (Gym
    // #221): it had answered 0 events with no word.
    requireOrderedWindow(from, to);
    const limit = Math.min(200, Math.max(1, Number(args.limit ?? 50)));
    // game_days_seen (3.17.0, call 6): a sighting is one /events read,
    // and game_event_day keeps only its UTC day; the read's instant is
    // on its receipt, so the game day (10:00Z grid) is the receipt's.
    // A UTC day with no receipt on record (the elixir-bot backfill's
    // sparser reads) keeps the UTC day as its game day.
    const { rows } = await ctx.db.query(
      `with sighting as (
           select distinct (r.fetched_at at time zone 'UTC')::date as day,
                  game_day(r.fetched_at) as game_day
           from api_receipt r
           where r.endpoint = 'events' and r.admission = 'admitted'
             and r.fetched_at >= $1::date - interval '1 day'
             and r.fetched_at < $2::date + interval '2 days')
         select e.event_tag, e.title, e.description, e.first_seen_at, e.last_seen_at,
                array_agg(distinct d.day::text order by d.day::text) as days,
                array_agg(distinct coalesce(s.game_day, d.day)::text order by coalesce(s.game_day, d.day)::text) as game_days,
                exists (select 1 from game_event_day x
                         where x.event_tag = e.event_tag
                           and x.day = (select max(day) from game_event_day)) as running_on_latest
         from game_event e
         join game_event_day d on d.event_tag = e.event_tag
         left join sighting s on s.day = d.day
         -- The days a read inside the echoed window saw (Gym #125): the
         -- window's instants, not the UTC dates around them, so a window
         -- holding no read returns nothing rather than yesterday's rows.
         where d.day in (
           select (r.fetched_at at time zone 'UTC')::date from api_receipt r
            where r.endpoint = 'events' and r.admission = 'admitted'
              and r.fetched_at >= $4 and r.fetched_at < $5)
         group by e.event_tag
         order by max(d.day) desc, min(d.day) desc
         limit $3`,
      // `to` is the exclusive instant (a date-only to resolves to the
      // NEXT midnight), so the last day inside it is the day before.
      [
        from.toISOString().slice(0, 10),
        new Date(to.getTime() - 1).toISOString().slice(0, 10),
        limit,
        from,
        to,
      ],
    );
    // The game days a read inside the window covered (Gym #126), served:
    // a day missing here is a day nothing was read, not a day of nothing.
    const { rows: readDays } = await ctx.db.query(
      `select distinct game_day(r.fetched_at)::text as day
         from api_receipt r
        where r.endpoint = 'events' and r.admission = 'admitted'
          and r.fetched_at >= $1 and r.fetched_at < $2
        order by 1`,
      [from, to],
    );
    // The game days in the window no events read covered (Gym #126): an
    // event's days skip them, which reads as the event being off.
    const { rows: gaps } = await ctx.db.query(
      `select gd::date::text as day
         from generate_series(game_day($1::timestamptz), game_day($2::timestamptz), interval '1 day') gd
        where gd::date < game_day(now())
          and not exists (
            select 1 from api_receipt r
             where r.endpoint = 'events' and r.admission = 'admitted'
               and game_day(r.fetched_at) = gd::date)`,
      [from, new Date(to.getTime() - 1)],
    );
    const seasonFields = await seasonFieldsForInstants(ctx.db, from, to, {
      flavor: "plain",
      clampToNow: false,
    });
    const futureNote =
      from.getTime() > Date.now()
        ? `The window starts ${from.toISOString()}, after now: no events read can fall in it yet, so the list is empty by construction, not a quiet stretch.`
        : null;
    // The horizon is a fact of the table, not a date in the code: the
    // daily sightings began 2026-09-11, and the elixir-bot backfill
    // (2026-09-15) placed earlier, sparser reads before them.
    const { rows: running } = await ctx.db.query(
      `select max(day)::text as latest_day, min(day)::text as first_day from game_event_day`,
    );
    return {
      applied: appliedBlock({
        window: {
          from: from.toISOString(),
          to: to.toISOString(),
          source:
            args.from !== undefined || args.to !== undefined
              ? "argument"
              : "default",
          ...seasonFields.echo,
        },
        limit,
      }),
      game_days_read: readDays.map((r) => r.day),
      first_sighting_day: running[0]?.first_day ?? null,
      latest_sighting_day: running[0]?.latest_day ?? null,
      events: rows.map((r) => ({
        event_tag: r.event_tag,
        title: r.title,
        description: r.description,
        game_days_seen: r.game_days,
        first_seen_at: r.first_seen_at.toISOString(),
        last_seen_at: r.last_seen_at.toISOString(),
        // A fact of the table, not of the window asked (3.17.0: a
        // window ending before the latest sighting said false).
        running_on_latest_day: r.running_on_latest,
      })),
      notes: notes(
        futureNote,
        seasonFields.seasonNotes,
        "game_days_seen is the game days (the 10:00Z grid the series tools use; a read before 10:00Z belongs to the day before) on which /events listed the event; the API gives no start or end, so an event's span is its first and last sighting, at daily resolution.",
        `Sightings began ${running[0]?.first_day ?? "when recording did"}; nothing before that date is known, and days without a read are unknown, not empty.`,
        "The game-mode leaderboards (rankings_players with board: mode) are the same modes' standings; a title here and a board name there usually match.",
        "The window selects the events reads made inside it (its instants, not the dates around them), and running_on_latest_day says the event was in the most recent read the record holds - as close to 'on now' as the record gets.",
        gaps.length
          ? `No events read covered the game day${gaps.length === 1 ? "" : "s"} ${gaps.map((g) => g.day).join(", ")}: an event's game_days_seen skip ${gaps.length === 1 ? "it" : "them"} because nothing was read, not because the event was off.`
          : null,
      ),
      docs: docsRef("recording", "leaderboards"),
      meta: await buildMeta(ctx.db, ctx.account, "GLOBAL", ["events"], {
        timezone: args.timezone,
      }),
    };
  },
};
