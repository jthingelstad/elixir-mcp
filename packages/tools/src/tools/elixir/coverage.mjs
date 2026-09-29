import { captureCoverage } from "../../coverage.mjs";
import {
  DISPLAY_NAME_SCHEMA,
  ON_BEHALF_OF_SCHEMA,
  TAG_SCHEMA,
  buildMeta,
  docsRef,
  notes,
  subject,
} from "../shared.mjs";

export const elixir_coverage = {
  description:
    "How complete the record is for a tag: recording start, last successful poll per endpoint, battles captured (including appearances recorded before the tag was tracked), capture estimates over observation intervals ending in the last seven days, and unmeasured_tail_hours since the latest profile snapshot. Use it to caveat answers honestly; missing coverage is unknown, not evidence of absence.",
  inputSchema: {
    type: "object",
    properties: {
      player_tag: TAG_SCHEMA,
      on_behalf_of: ON_BEHALF_OF_SCHEMA,
      display_name: DISPLAY_NAME_SCHEMA,
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
    const polls = await ctx.db.query(
      `select endpoint, last_admitted_at from poll_state where subject_tag = $1 order by endpoint`,
      [tag],
    );
    const battles = await ctx.db.query(
      `select count(*)::int as appearances, min(b.battle_time) as first_seen, max(b.battle_time) as last_seen
         from battle_participant bp join battle b on b.battle_id = bp.battle_id
         where bp.player_tag = $1`,
      [tag],
    );
    const coverage = await captureCoverage(ctx.db, tag);
    const snapEpoch = await ctx.db.query(
      `select min(snapshot_date)::text as first from player_snapshot_daily
         where player_tag = $1 and snapshot_kind = 'daily'`,
      [tag],
    );
    const b = battles.rows[0];
    // captureCoverage carries its own note fields; fold them into notes.
    const { completeness_last_7_days, ...restCoverage } = coverage;
    const weekNote = completeness_last_7_days?.note;
    const week = completeness_last_7_days
      ? { ...completeness_last_7_days }
      : undefined;
    if (week) delete week.note;
    return {
      player_tag: tag,
      polls: polls.rows.map((r) => ({
        endpoint: r.endpoint,
        last_admitted_at: r.last_admitted_at?.toISOString() ?? null,
      })),
      battles: {
        recorded_appearances: b.appearances,
        first_recorded: b.first_seen?.toISOString() ?? null,
        last_recorded: b.last_seen?.toISOString() ?? null,
      },
      snapshots: {
        first_date: snapEpoch.rows[0]?.first ?? null,
      },
      ...restCoverage,
      ...(week ? { completeness_last_7_days: week } : {}),
      notes: notes(
        b.appearances > 0
          ? `This tag appears in ${b.appearances} recorded battles since ${b.first_seen?.toISOString()?.slice(0, 10)}, including any recorded before it was tracked.`
          : "No battles recorded yet for this tag.",
        "Battle capture, daily snapshots and active recording can each begin at different times; timeline data exists only from snapshots.first_date.",
        weekNote
          ? "completeness_last_7_days covers observation intervals ENDING in the last seven days; compare measured_hours against 168 before reading average_ratio as a week, and treat unmeasured_tail_hours after the latest profile as unknown."
          : null,
      ),
      docs: docsRef("recording", "completeness"),
      meta: await buildMeta(ctx.db, ctx.account, tag, [
        "player",
        "player_battlelog",
      ]),
    };
  },
};
