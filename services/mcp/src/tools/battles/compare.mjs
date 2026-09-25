import { modeGroupSql, responseMeta } from "@elixir-mcp/contracts";
import {
  MODE_SCHEMA,
  SEASON_ARG_SCHEMA,
  ToolFailure,
  WINDOW_ARGS,
  appliedBlock,
  docsRef,
  notes,
  resolveSeasonWindow,
  subject,
} from "../shared.mjs";
import { modeClause, ownBattlesClause } from "./common.mjs";

export const battles_compare = {
  description:
    "Side-by-side of 2-4 recorded tags (any recorded player): latest snapshot topline plus a shared performance window. mode reads one mode group; with no mode each player's window carries its per-mode split.",
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
      season: SEASON_ARG_SCHEMA,
      mode: MODE_SCHEMA,
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
    const win = await resolveSeasonWindow(ctx, args, {
      seasonDefault: false,
    });
    const { from, to } = win;
    const players = [];
    for (const tag of tags) {
      const { rows: snap } = await ctx.db.query(
        `select p.name, s.trophies, s.donations, s.battle_count, s.collection_level
           from player p
           left join lateral (
             select * from player_snapshot_daily where player_tag = p.player_tag
               and profile_observed_at is not null
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
        where.push(`bp.battle_time >= $${params.length}`);
      }
      if (to) {
        params.push(to);
        where.push(`bp.battle_time < $${params.length}`);
      }
      const add = (clause, value) => {
        if (!clause.includes("?")) return where.push(clause);
        params.push(value);
        where.push(clause.replace("?", `$${params.length}`));
      };
      // A member's own battles (boat defenses are not theirs, 0171), in
      // the one mode group asked for, or every mode split beside the
      // pooled record (DECISIONS: mode discipline).
      ownBattlesClause(add);
      modeClause(args, add);
      const { rows: perf } = await ctx.db.query(
        `select count(*)::int battles,
                  count(*) filter (where bp.outcome = 'win')::int wins,
                  count(*) filter (where bp.outcome = 'loss')::int losses,
                  coalesce(sum(bp.trophy_change), 0)::int net_trophies,
                  (select json_object_agg(g, json_build_object(
                            'battles', n, 'wins', w, 'losses', l))
                     from (select ${modeGroupSql("b.type", "b.event_tag")} as g,
                                  count(*)::int as n,
                                  count(*) filter (where bp.outcome = 'win')::int as w,
                                  count(*) filter (where bp.outcome = 'loss')::int as l
                             from battle_participant bp
                             join battle b on b.battle_id = bp.battle_id
                            where ${where.join(" and ")}
                            group by 1) m) as modes
           from battle_participant bp join battle b on b.battle_id = bp.battle_id
           where ${where.join(" and ")}`,
        params,
      );
      const { modes, ...window } = perf[0];
      players.push({
        player_tag: tag,
        ...snap[0],
        window: { ...window, ...(args.mode ? {} : { modes: modes ?? {} }) },
      });
    }
    return {
      applied: appliedBlock({
        window: win.echo,
        player_tags: tags,
        mode: args.mode,
      }),
      players,
      notes: notes(
        !args.mode &&
          players.some((p) => Object.keys(p.window.modes ?? {}).length > 1)
          ? "Each window pools every mode group it played (window.modes says which): modes are different games with different matchmaking, so compare players within a mode; pass mode to read one."
          : null,
        win.seasonNotes,
        "window covers RECORDED battles only, and recording start dates differ per player; net_trophies sums recorded trophy changes, not the full ladder delta.",
      ),
      docs: docsRef("recording", "completeness"),
      meta: responseMeta({
        as_of: new Date().toISOString(),
        ...(win.timezone ? { timezone_applied: win.timezone } : {}),
      }),
    };
  },
};
