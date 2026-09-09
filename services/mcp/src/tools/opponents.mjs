/** battles_opponents — the opponent axis (feedback #14): the corpus held
 *  every opponent tag and exposed no way to group on it, so "have I faced
 *  this player before" cost a five-page sweep tallied client-side. */

import { MODE_GROUPS, typesForModeGroup } from "@elixir-mcp/contracts";
import { resolveInstant } from "../time.mjs";
import {
  requireEnum,
  ToolFailure,
  TAG_SCHEMA,
  ON_BEHALF_OF_SCHEMA,
  subject,
  buildMeta,
  requireOrderedWindow,
} from "./shared.mjs";

export const opponentsTools = {
  battles_opponents: {
    description:
      "A player's recorded battles grouped by OPPONENT: per opponent the record (W/L/D), first and last meeting, the modes it happened in, clan at last meeting, and the opponent's name where the service has ever observed one (name_known says so). min_battles: 2 answers \"who have I faced more than once\" in one call. Head-to-head only: teammates are not opponents, and a boat defense counts as the defender it names. The discovery half of battles_query's opponent_tag filter.",
    inputSchema: {
      type: "object",
      properties: {
        player_tag: TAG_SCHEMA,
        on_behalf_of: ON_BEHALF_OF_SCHEMA,
        from: {
          type: "string",
          description: "ISO instant or YYYY-MM-DD (your timezone).",
        },
        to: { type: "string" },
        mode: { type: "string", enum: MODE_GROUPS },
        min_battles: {
          type: "integer",
          minimum: 1,
          default: 1,
          description:
            "Only opponents met at least this many times (2 = repeats only).",
        },
        sort: {
          type: "string",
          enum: ["battles", "last_seen", "wins"],
          default: "battles",
        },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
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
      const tz = ctx.account.timezone;
      const where = ["me.player_tag = $1", "o.side <> me.side"];
      const params = [tag];
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
      if (to) add("b.battle_time < ?", to);
      requireOrderedWindow(from, to);
      requireEnum(args.mode, MODE_GROUPS, "mode");
      if (args.mode) add("b.type = any(?)", typesForModeGroup(args.mode));
      requireEnum(args.sort, ["battles", "last_seen", "wins"], "sort");
      const minBattles = Math.max(1, Number(args.min_battles ?? 1));
      if (!Number.isInteger(minBattles))
        throw new ToolFailure("bad_request", "min_battles must be an integer.");
      const limit = Math.min(Math.max(Number(args.limit ?? 50), 1), 200);
      const order =
        args.sort === "last_seen"
          ? "max(b.battle_time) desc"
          : args.sort === "wins"
            ? "count(*) filter (where me.outcome = 'win') desc, count(*) desc"
            : "count(*) desc, max(b.battle_time) desc";
      const { rows } = await ctx.db.query(
        `select o.player_tag, p.name,
                count(*)::int as battles,
                count(*) filter (where me.outcome = 'win')::int as wins,
                count(*) filter (where me.outcome = 'loss')::int as losses,
                count(*) filter (where me.outcome = 'draw')::int as draws,
                min(b.battle_time) as first_seen,
                max(b.battle_time) as last_seen,
                array_agg(distinct coalesce(b.game_mode_name, b.type)) as modes,
                (array_agg(o.clan_tag order by b.battle_time desc))[1] as clan_tag,
                count(*) over ()::int as distinct_opponents
         from battle_participant me
         join battle b on b.battle_id = me.battle_id
         join battle_participant o on o.battle_id = me.battle_id
         join player p on p.player_tag = o.player_tag
         where ${where.join(" and ")}
         group by o.player_tag, p.name
         having count(*) >= ${minBattles}
         order by ${order}
         limit ${limit}`,
        params,
      );
      const { rows: total } = await ctx.db.query(
        `select count(distinct o.player_tag)::int as n
         from battle_participant me
         join battle b on b.battle_id = me.battle_id
         join battle_participant o on o.battle_id = me.battle_id
         where ${where.join(" and ")}`,
        params,
      );
      return {
        player_tag: tag,
        distinct_opponents: total[0]?.n ?? 0,
        matching_opponents: rows[0]?.distinct_opponents ?? 0,
        limit_applied: limit,
        opponents: rows.map((r) => ({
          player_tag: r.player_tag,
          name: r.name,
          name_known: r.name !== null,
          battles: r.battles,
          wins: r.wins,
          losses: r.losses,
          draws: r.draws,
          first_seen: r.first_seen.toISOString(),
          last_seen: r.last_seen.toISOString(),
          modes: r.modes,
          clan_tag_last_seen: r.clan_tag,
        })),
        note: "Head-to-head rows only; 2v2 teammates never appear. A duel counts once however many rounds it held. name_known: false means no roster, profile or battlelog observation ever carried a name for that tag - players_names resolves the ones the corpus knows, and players_profile(live: true) can fetch one at a live-lane cost.",
        meta: await buildMeta(ctx.db, ctx.account, tag),
      };
    },
  },
};
