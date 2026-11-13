import { normalizeTag, responseMeta } from "@elixir-mcp/contracts";
import { playerHighlights, shownAt } from "../activity/entries.mjs";
import { primaryOf, socialOf, socialReader } from "../social.mjs";
import {
  TAG_RULE_HINT,
  ToolFailure,
  appliedBlock,
  docsRef,
  notes,
} from "./shared.mjs";

/**
 * The social layer's player reads (DECISIONS "Agents read the social layer
 * and never write it"): who a player follows and who follows them, and the
 * highlights they posted, exactly as their player page shows them. A
 * person's own connection reads as that person; an agent reads as its
 * owner. Never a nickname, an email or a
 * Discord username.
 */

const SOCIAL_REFUSAL = [
  "not_entitled",
  "The social layer is read by a person's own connection and their agents.",
  "Connect as yourself at /mcp, or through an agent of yours whose owner is approved.",
];

/** The reader, or the refusal every social read gives. */
export async function socialReaderOrRefuse(ctx) {
  const reader = await socialReader(ctx.db, ctx.account);
  if (!reader) throw new ToolFailure(...SOCIAL_REFUSAL);
  return reader;
}

/** The player a social read is about: the tag named, or the reader's
 *  primary (the owner's, for an agent). Must be a recorded player. */
async function socialSubject(ctx, reader, input) {
  let tag;
  if (input === undefined || input === null || input === "") {
    tag = await primaryOf(ctx.db, reader.accountId);
    if (!tag)
      throw new ToolFailure(
        "no_subject",
        reader.asOwner
          ? "Your owner has no primary player in Elixir."
          : "You have no primary player in Elixir.",
        "Name a player with player_tag, or set a primary player in Settings, Players & following.",
      );
  } else {
    try {
      tag = normalizeTag(input);
    } catch {
      throw new ToolFailure(
        "invalid_tag",
        `Not a Clash Royale tag: ${String(input).slice(0, 40)}`,
        TAG_RULE_HINT,
      );
    }
  }
  const { rows } = await ctx.db.query(
    `select name from player where player_tag = $1`,
    [tag],
  );
  if (!rows[0])
    throw new ToolFailure(
      "not_recorded",
      `Elixir records no player ${tag}.`,
      "Follow the player first (elixir_follow_player), or check the tag.",
    );
  return { tag, name: rows[0].name ?? null };
}

const PLAYER_TAG = {
  type: "string",
  description:
    "Player tag like #20JJJ2CCRU. Omit to mean your primary player (your owner's, for an agent).",
};

export const socialTools = {
  players_follows: {
    description:
      "Who a player follows and who follows them, exactly as their player page shows it: badges (verified_player, discord: that the account linked one, never which), follows (the players their account follows) and followers (people following them, named by the player each verified; the rest counted as unnamed). follows and followers are null when no account has verified the player. Defaults to your primary player. For a person's own connection and their agents.",
    inputSchema: {
      type: "object",
      properties: { player_tag: PLAYER_TAG },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const reader = await socialReaderOrRefuse(ctx);
      const who = await socialSubject(ctx, reader, args.player_tag);
      const social = await socialOf(ctx.db, who.tag);
      return {
        player_tag: who.tag,
        name: who.name,
        ...social,
        applied: appliedBlock({ player_tag: who.tag }),
        notes: notes(
          social.follows === null
            ? "No account has verified this player, so it has no follows or followers to show."
            : "A follower is named by the player their account verified; a follower with no verified player is counted in unnamed, never named.",
          social.follows && social.follows.count > social.follows.players.length
            ? `follows lists the first ${social.follows.players.length} of ${social.follows.count} by name.`
            : null,
        ),
        docs: docsRef("player-page", "follows-followers-and-badges"),
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },
  players_highlights: {
    description:
      "The highlights a player posted, newest first, as their player page shows them: each one's sentence, the words they wrote and a link to the battle. Every one they posted, not a window's. Defaults to your primary player. For a person's own connection and their agents; reading never posts or cheers.",
    inputSchema: {
      type: "object",
      properties: {
        player_tag: PLAYER_TAG,
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 30,
          default: 10,
          description: "How many, newest first: 1 to 30, default 10.",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const reader = await socialReaderOrRefuse(ctx);
      const who = await socialSubject(ctx, reader, args.player_tag);
      const limit = args.limit ?? 10;
      const found = await playerHighlights(ctx.db, who.tag, { limit });
      return {
        player_tag: who.tag,
        name: who.name,
        highlights: found.map((it) => ({
          id: it.id ?? null,
          at: shownAt(it) || it.at || null,
          text: String(it.text ?? ""),
          words: it.facts?.words ?? null,
          battle_url: it.facts?.battle?.url ?? null,
        })),
        applied: appliedBlock({ player_tag: who.tag, limit }),
        notes: notes(
          found.length === 0 ? "This player has posted no highlights." : null,
        ),
        docs: docsRef("timeline", "highlights"),
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },
};
