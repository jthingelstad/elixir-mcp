import { normalizeTag, responseMeta, roleQuotas } from "@elixir-mcp/contracts";
import {
  TAG_RULE_HINT,
  ToolFailure,
  appliedBlock,
  ensureClanRecording,
  notes,
  settleClanRecording,
} from "../shared.mjs";
import { RECORDING_DOCS } from "./common.mjs";

export const elixir_track_clan = {
  description:
    "Track a clan on your account: starts recording in one act (tracked means recorded), within your tier's clan slots. scope activity records roster and war; comprehensive additionally records every member's battles and profile, following membership. action remove takes it off your account (recording stops when no account has it); notify_on / notify_off control whether it feeds your elixir_timeline.",
  inputSchema: {
    type: "object",
    properties: {
      clan_tag: {
        type: "string",
        description: "The clan tag, like #J2RGCRVG.",
      },
      action: {
        type: "string",
        enum: ["add", "remove", "notify_on", "notify_off"],
        default: "add",
      },
      scope: {
        type: "string",
        enum: ["activity", "comprehensive"],
        default: "comprehensive",
        description:
          "With add: activity records the clan itself; comprehensive additionally records every member. Tracking again with a different scope updates yours.",
      },
    },
    required: ["clan_tag"],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    let tag;
    try {
      tag = normalizeTag(String(args.clan_tag ?? ""));
    } catch {
      throw new ToolFailure("invalid_tag", "Invalid clan tag.", TAG_RULE_HINT);
    }
    const action = args.action ?? "add";
    if (action === "notify_on" || action === "notify_off") {
      const { rowCount } = await ctx.db.query(
        `update account_clan set notify = $3 where account_id = $1 and clan_tag = $2`,
        [ctx.account.accountId, tag, action === "notify_on"],
      );
      if (rowCount === 0) {
        throw new ToolFailure(
          "not_entitled",
          "You are not tracking this clan.",
          "Track the clan first; notify is a setting on YOUR copy of it.",
        );
      }
      return {
        clan_tag: tag,
        notify: action === "notify_on",
        applied: appliedBlock({ clan_tag: tag, action }),
        docs: RECORDING_DOCS,
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    }
    if (action === "remove") {
      const { rowCount } = await ctx.db.query(
        `delete from account_clan where account_id = $1 and clan_tag = $2`,
        [ctx.account.accountId, tag],
      );
      let recordingStopped = false;
      if (rowCount > 0) {
        recordingStopped = await settleClanRecording(ctx.db, tag);
        if (recordingStopped) {
          await ctx.db.query(
            `insert into account_event (account_id, kind, detail) values ($1, 'recording_stopped', $2)`,
            [
              ctx.account.accountId,
              JSON.stringify({ clan_tag: tag, via: "mcp" }),
            ],
          );
        }
      }
      return {
        clan_tag: tag,
        removed: rowCount > 0,
        recording_stopped: recordingStopped,
        applied: appliedBlock({ clan_tag: tag, action }),
        notes: notes(
          "History already recorded is kept; the shared recording stops only when no account tracks the clan.",
        ),
        docs: RECORDING_DOCS,
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    }
    // action 'add': slots count clans you track, per scope.
    const scope = args.scope === "activity" ? "activity" : "comprehensive";
    if (!ctx.account.isOwner && ctx.account.role !== "admin") {
      const { rows: slots } = await ctx.db.query(
        `select exists (select 1 from gateway g
                          where g.owner_account_id = $1 and g.status = 'active') as operator,
                  (select count(*)::int from account_clan ac
                   where ac.account_id = $1 and ac.scope = $2
                     and ac.clan_tag <> $3) as used
           from account a where a.account_id = $1`,
        [ctx.account.accountId, scope, tag],
      );
      const q = roleQuotas(ctx.account.role, {
        operator: slots[0]?.operator ?? false,
      });
      const limit =
        scope === "activity" ? q.activity_clans : q.comprehensive_clans;
      if ((slots[0]?.used ?? 0) >= limit) {
        throw new ToolFailure(
          "quota_exceeded",
          limit === 0
            ? `The ${ctx.account.role ?? "member"} tier has no ${scope}-scope clan slots.`
            : `Your ${scope}-scope clan slots are full (${limit} for the ${ctx.account.role ?? "member"} tier).`,
          scope === "comprehensive"
            ? "Comprehensive capture records every member's battles; the leader tier and above include it. Request an upgrade on the website, or track at scope 'activity'."
            : "Request a tier upgrade on the website; elixir_docs({ page: 'roles' }) has the ladder.",
        );
      }
    }
    await ctx.db.query(
      `insert into clan (clan_tag) values ($1) on conflict do nothing`,
      [tag],
    );
    const { rowCount: added } = await ctx.db.query(
      `insert into account_clan (account_id, clan_tag, scope) values ($1, $2, $3)
         on conflict (account_id, clan_tag) do update set scope = excluded.scope`,
      [ctx.account.accountId, tag, scope],
    );
    const started = await ensureClanRecording(
      ctx.db,
      tag,
      ctx.account.accountId,
    );
    if (started) {
      await ctx.db.query(
        `insert into account_event (account_id, kind, detail) values ($1, 'recording_started', $2)`,
        [
          ctx.account.accountId,
          JSON.stringify({ clan_tag: tag, scope, via: "mcp" }),
        ],
      );
      // The account_event row above is the timeline's record of this.
    }
    return {
      clan_tag: tag,
      added: added > 0,
      recording: "active",
      scope,
      notify: true,
      applied: appliedBlock({ clan_tag: tag, action, scope }),
      notes: notes(
        started
          ? "Tracked and recording: roster and war capture begin within minutes; comprehensive member fan-out follows on the next scheduler pass."
          : "Tracked; this clan was already being recorded, so you share the existing record (the effective scope is the widest any tracker requested).",
      ),
      docs: RECORDING_DOCS,
      meta: responseMeta({ as_of: new Date().toISOString() }),
    };
  },
};
