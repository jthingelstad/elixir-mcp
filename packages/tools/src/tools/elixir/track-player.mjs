import { normalizeTag, responseMeta } from "@elixir-mcp/contracts";
import { addPlayer, removePlayer } from "@elixir-mcp/claims";
import { requestFirstRead } from "../../live.mjs";
import { TAG_RULE_HINT, ToolFailure, appliedBlock, notes } from "../shared.mjs";
import { RECORDING_DOCS } from "./common.mjs";

export const elixir_track_player = {
  description:
    "Track a player on your account: claims the tag AND starts recording in one act (tracked means recorded), within your player slots (an agent spends its owner's). Say who they are to you with relationship (primary = you, alt = also you, friend, watching); your first player becomes your primary. An agent tracks as watching only. action remove releases the claim (recording stops if you were its only reason); notify_on / notify_off control whether the player feeds your elixir_timeline.",
  inputSchema: {
    type: "object",
    properties: {
      player_tag: {
        type: "string",
        description: "The tag, like #20JJJ2CCRU.",
      },
      action: {
        type: "string",
        enum: ["add", "remove", "notify_on", "notify_off"],
        default: "add",
      },
      relationship: {
        type: "string",
        enum: ["primary", "alt", "friend", "watching"],
        description:
          "Who this player is TO YOU: primary is you (exactly one; setting it on another tag moves it), alt is also you, friend is someone you follow, watching is everyone else (default). All four share your tier's player slots.",
      },
    },
    required: ["player_tag"],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    let tag;
    try {
      tag = normalizeTag(String(args.player_tag ?? ""));
    } catch {
      throw new ToolFailure(
        "invalid_tag",
        "Invalid player tag.",
        TAG_RULE_HINT,
      );
    }
    const action = args.action ?? "add";
    if (action === "notify_on" || action === "notify_off") {
      const { rowCount } = await ctx.db.query(
        `update claim set notify = $3 where account_id = $1 and player_tag = $2`,
        [ctx.account.accountId, tag, action === "notify_on"],
      );
      if (rowCount === 0) {
        throw new ToolFailure(
          "not_entitled",
          "You are not tracking this player.",
          "Track the tag first; notify is a setting on YOUR copy of it.",
        );
      }
      return {
        player_tag: tag,
        notify: action === "notify_on",
        applied: appliedBlock({ player_tag: tag, action }),
        docs: RECORDING_DOCS,
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    }
    if (action === "remove") {
      const r = await removePlayer(ctx.db, ctx.account, { tag, via: "mcp" });
      if (r.refused === "primary_in_use")
        throw new ToolFailure(
          "bad_request",
          `${tag} is your primary player and you track others, so it cannot be removed yet.`,
          "Make another of your players your primary first (the console's Players page, or elixir_track_player with relationship 'primary'), then remove this one.",
        );
      return {
        player_tag: tag,
        removed: r.removed,
        recording_stopped: r.recordingStopped,
        primary_player_tag: r.promotedPrimary,
        applied: appliedBlock({ player_tag: tag, action }),
        notes: notes(
          "History already recorded is kept; only the recording stops when no reason remains.",
        ),
        docs: RECORDING_DOCS,
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    }
    // 'add': tracked = recorded. Slots count what you track (your
    // claims); owner/admin exempt - the website applies the same rule
    // through the same function.
    const r = await addPlayer(ctx.db, ctx.account, {
      tag,
      makePrimary: args.relationship === "primary",
      relationship: args.relationship ?? null,
      via: "mcp",
    });
    if (!r.ok && r.error === "quota_exceeded") {
      throw new ToolFailure(
        "quota_exceeded",
        `Tracked players are capped at ${r.limit} for the ${r.role} tier.`,
        "Remove one, request a tier upgrade on the website, or run a collector for bonus slots.",
      );
    }
    if (!r.ok && r.error === "not_entitled")
      throw new ToolFailure(
        "not_entitled",
        "An agent tracks players as watching only.",
        "A player an agent tracks is never it: omit relationship, or pass watching.",
      );
    if (!r.ok) {
      throw new ToolFailure("not_found", "Account not found.");
    }
    // claims logs recording_started; logging it here too wrote it twice.
    // A new tag gets one free live read of its profile (live.mjs), so a
    // tag the game does not have is known in minutes, not at the next
    // scheduled poll, and the primary player's clan with it.
    const first = r.added
      ? await requestFirstRead(ctx.db, ctx.live, tag)
      : { requested: false };
    return {
      player_tag: tag,
      added: r.added,
      recording: "active",
      recording_started: r.recordingStarted,
      notify: true,
      applied: appliedBlock({
        player_tag: tag,
        action,
        relationship: args.relationship ?? "watching",
      }),
      notes: notes(
        r.recordingStarted
          ? "Tracked and recording: the first capture usually lands within a few minutes and brings roughly the last 30 battles with it; history builds from there (the API has no past)."
          : "Tracked; this player was already being recorded, so you share the existing record from here on.",
        first.not_found
          ? `Clash Royale answered "not found" for ${tag} on its last read today: check the tag (in the game, open the player's profile; the tag is below the name), and remove it with action remove if it is wrong.`
          : null,
        first.requested
          ? "A first read of this profile is on its way; if Clash Royale has no player with this tag, the Console's capture status says so within minutes."
          : null,
        r.clanFollowed
          ? `Your primary player's clan ${r.clanFollowed} is now followed at activity scope (roster, members coming and going, river races). Stop tracking it with elixir_track_clan action remove and it is not followed again.`
          : null,
        "Captures appear on your elixir_timeline while notify is on.",
      ),
      docs: RECORDING_DOCS,
      meta: responseMeta({ as_of: new Date().toISOString() }),
    };
  },
};
