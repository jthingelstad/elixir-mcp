import { responseMeta } from "@elixir-mcp/contracts";
import {
  SEASON_ARG_SCHEMA,
  ToolFailure,
  WINDOW_ARGS,
  appliedBlock,
  docsRef,
  notes,
  resolveSeasonWindow,
  subject,
} from "../shared.mjs";

export const battles_compare = {
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
      season: SEASON_ARG_SCHEMA,
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
