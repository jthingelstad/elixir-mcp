import { normalizeTag, responseMeta } from "@elixir-mcp/contracts";
import { addClan, removeClan } from "@elixir-mcp/claims";
import { TAG_RULE_HINT, ToolFailure, appliedBlock, notes } from "../shared.mjs";
import { RECORDING_DOCS } from "./common.mjs";

export const elixir_follow_clan = {
  description:
    "Follow a clan on your account: starts recording in one act (followed means recorded), within your clan slots (an agent spends its owner's). scope activity records roster and war; comprehensive also records every member's battles and profile. An agent can follow a rival or a family clan; the clan it acts for stays. action remove takes it off your account (recording stops when no account has it); notify_on / notify_off control whether it feeds your elixir_timeline.",
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
          "With add: activity records the clan itself; comprehensive additionally records every member. Following again with a different scope updates yours.",
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
          "You are not following this clan.",
          "Follow the clan first; notify is a setting on YOUR copy of it.",
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
      const r = await removeClan(ctx.db, ctx.account, { tag, via: "mcp" });
      if (!r.ok)
        throw new ToolFailure(
          "not_entitled",
          r.error === "last_clan"
            ? "This is the only clan this agent acts for."
            : "This is the clan this agent acts for.",
          "An agent keeps the clan it acts for. Its owner can make another of its clans the one it acts for from the agent's page in Settings, and then remove this one.",
        );
      return {
        clan_tag: tag,
        removed: r.removed,
        recording_stopped: r.recordingStopped,
        applied: appliedBlock({ clan_tag: tag, action }),
        notes: notes(
          "History already recorded is kept; the shared recording stops only when no account follows the clan.",
        ),
        docs: RECORDING_DOCS,
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    }
    // action 'add': within the pool's clan slots (the person's, shared with
    // their agents); the console runs the same function (2026-09-23).
    const r = await addClan(ctx.db, ctx.account, {
      tag,
      scope: args.scope,
      via: "mcp",
    });
    if (!r.ok && r.error === "quota_exceeded")
      throw new ToolFailure(
        "quota_exceeded",
        r.limit === 0
          ? `The ${r.role} role has no ${r.scope}-scope clan slots.`
          : `Your ${r.scope}-scope clan slots are full (${r.limit} for the ${r.role} role${ctx.account.kind === "agent" ? ", shared with its owner and their agents" : ""}).`,
        r.scope === "comprehensive"
          ? "Comprehensive capture records every member's battles; the leader role and above include it. Leader is earned while a verified player of yours leads or co-leads a clan you follow; or follow at scope 'activity'."
          : "Tiers are earned: leading a clan you follow gives Leader, running an active collector gives Family; elixir_docs({ page: 'roles' }) has the ladder.",
      );
    if (!r.ok)
      throw new ToolFailure(
        "not_entitled",
        "This account cannot follow clans.",
      );
    const { added, scope, recordingStarted: started } = r;
    return {
      clan_tag: tag,
      added,
      recording: "active",
      scope,
      notify: true,
      applied: appliedBlock({ clan_tag: tag, action, scope }),
      notes: notes(
        started
          ? "Followed and recording: roster and war capture begin within minutes; comprehensive member fan-out follows on the next scheduler pass."
          : "Followed; this clan was already being recorded, so you share the existing record (the effective scope is the widest any follower requested).",
      ),
      docs: RECORDING_DOCS,
      meta: responseMeta({ as_of: new Date().toISOString() }),
    };
  },
};
