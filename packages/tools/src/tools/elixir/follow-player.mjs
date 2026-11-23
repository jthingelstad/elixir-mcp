import { normalizeTag, responseMeta } from "@elixir-mcp/contracts";
import {
  addPlayer,
  linkAfterFollow,
  unfollowPlayerLinked,
} from "@elixir-mcp/claims";
import { requestFirstRead } from "../../live.mjs";
import { TAG_RULE_HINT, ToolFailure, appliedBlock, notes } from "../shared.mjs";
import { RECORDING_DOCS } from "./common.mjs";

export const elixir_follow_player = {
  description:
    "Follow a player and record them. It spends a player slot only when Elixir records them because of you; slot says. relationship is primary (you), alt (also you), or friend (any other player). A person's first unnamed tag is primary; later tags default to friend. A tag another account verified is friend-only. A person's friend follow also follows that account and its verified players. action remove releases the claim; notify_on / notify_off set the Timeline feed.",
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
        enum: ["primary", "alt", "friend"],
        description:
          "Who this player is TO YOU: primary is you (exactly one; setting it on another tag moves it), alt is also you, friend is any other player you follow (the default for later additions and for agents). All three share your player slots, and none costs one for a player Elixir already records.",
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
          "You are not following this player.",
          "Follow the tag first; notify is a setting on YOUR copy of it.",
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
      // Linked follows: a player followed through its verifying account
      // ends the whole link (Jamie, 2026-11-15).
      const r = await unfollowPlayerLinked(ctx.db, ctx.account, {
        tag,
        via: "mcp",
      });
      if (r.refused === "primary_in_use")
        throw new ToolFailure(
          "bad_request",
          `${tag} is your primary player and you follow others, so it cannot be removed yet.`,
          "Make another of your players your primary first (Settings, Players & following, or elixir_follow_player with relationship 'primary'), then remove this one.",
        );
      return {
        player_tag: tag,
        removed: r.removed,
        recording_stopped: r.recordingStopped,
        primary_player_tag: r.promotedPrimary,
        ...(r.unlinked ? { unfollowed: r.unlinked.unfollowed } : {}),
        applied: appliedBlock({ player_tag: tag, action }),
        notes: notes(
          "History already recorded is kept; only the recording stops when no reason remains.",
          r.unlinked
            ? `You followed ${tag} through the account that verified it, so that account and all its verified players are unfollowed too.`
            : null,
        ),
        docs: RECORDING_DOCS,
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    }
    // 'add': followed = recorded. A follow costs a slot only when Elixir
    // records the player because of you (#760, claims pool.mjs); owner and
    // admin are exempt. The website applies the same rule through the same
    // function.
    const r = await addPlayer(ctx.db, ctx.account, {
      tag,
      makePrimary: args.relationship === "primary",
      relationship: args.relationship ?? null,
      via: "mcp",
    });
    if (!r.ok && r.error === "quota_exceeded") {
      throw new ToolFailure(
        "quota_exceeded",
        r.message,
        "Remove a player who uses a slot (elixir_my_players lists them), or follow players Elixir already records, which stays free.",
      );
    }
    // A verified tag is its owner's (#556): the answer every door gives.
    if (!r.ok && r.error === "verified_elsewhere")
      throw new ToolFailure(
        "not_entitled",
        r.message,
        "Following them is still open: pass relationship friend.",
      );
    if (!r.ok) {
      throw new ToolFailure("not_found", "Account not found.");
    }
    // claims logs recording_started; logging it here too wrote it twice.
    // A new tag gets one free live read of its profile (live.mjs), so a
    // tag the game does not have is known in seconds, not at the next
    // scheduled poll, and the primary player's clan with it; then its
    // battle log on the same lane (2026-11-09), so the last 30 battles
    // land with it. Every door's add is a person's (or a family app's for
    // the signed-in person), so every door asks the same.
    const first = r.added
      ? await requestFirstRead(ctx.db, ctx.live, tag, ctx.account.accountId, {
          battles: true,
        })
      : { requested: false };
    const battlesToo = first.battles?.requested === true;
    // Linked follows (Jamie, 2026-11-15): a person's friend follow of a
    // player another account verified follows that account and its other
    // verified players.
    const linked = await linkAfterFollow(ctx.db, ctx.account, tag, {
      via: "mcp",
    });
    const slot = r.slot;
    const limit = slot.limit === Infinity ? null : slot.limit;
    const of =
      limit === null ? `${slot.used} used` : `${slot.used} of ${limit}`;
    return {
      player_tag: tag,
      added: r.added,
      recording: "active",
      recording_started: r.recordingStarted,
      notify: r.notify,
      slot: {
        took: slot.took,
        free: slot.free,
        free_because: slot.reason,
        used: slot.used,
        limit,
      },
      ...(linked
        ? {
            linked: {
              followed: linked.followed,
              skipped: linked.skipped.map((x) => ({
                player_tag: x.tag,
                reason: x.reason,
              })),
            },
          }
        : {}),
      applied: appliedBlock({
        player_tag: tag,
        action,
        relationship: r.relationship,
      }),
      notes: notes(
        r.recordingStarted
          ? battlesToo
            ? "Followed and recording: the profile and roughly the last 30 battles usually land within a minute, and can take a few at busy times; history builds from there (the API has no past)."
            : "Followed and recording: the first capture usually lands within a few minutes and brings roughly the last 30 battles with it; history builds from there (the API has no past)."
          : "Followed; this player was already being recorded, so you share the existing record from here on.",
        first.not_found
          ? `Clash Royale answered "not found" for ${tag} on its last read today: check the tag (in the game, open the player's profile; the tag is below the name), and remove it with action remove if it is wrong.`
          : null,
        r.noOwnPlayer
          ? "This account has no player of its own yet, so a tool that defaults to you has nobody to mean: add yours with relationship primary."
          : null,
        first.requested
          ? battlesToo
            ? "A first read of this profile and its battle log is on its way; if Clash Royale has no player with this tag, the player's page in Settings says so within a minute or two."
            : "A first read of this profile is on its way; if Clash Royale has no player with this tag, the player's page in Settings says so within a minute or two."
          : null,
        r.clanFollowed
          ? `Your primary player's clan ${r.clanFollowed} is now followed at activity scope (roster, members coming and going, river races). Stop following it with elixir_follow_clan action remove and it is not followed again.`
          : null,
        slot.free
          ? `Free: no slot taken, because Elixir already records this player (${slot.reason === "in_recorded_clan" ? "a member of a clan recorded at comprehensive scope" : "another account followed them first"}). If that stops, they keep recording and start using a slot. Player slots: ${of}.`
          : slot.took
            ? `This used 1 of your player slots: ${of}.`
            : `This player uses one of your player slots: ${of}.`,
        linked
          ? `${tag} is verified by another account, so you follow that account too, and each player it verified: ${linked.followed.length} more followed${linked.skipped.length ? `, ${linked.skipped.length} skipped (no free slot, or no player of your own)` : ""}.`
          : null,
        "Captures appear on your elixir_timeline while notify is on.",
      ),
      docs: RECORDING_DOCS,
      meta: responseMeta({ as_of: new Date().toISOString() }),
    };
  },
};
