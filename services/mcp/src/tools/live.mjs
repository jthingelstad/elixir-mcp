/** live_fetch — the catch-all: one allowlisted raw GET against the CR API
 *  through the live lane. It is meant to be RARE (Jamie, 2026-09-10):
 *  frequent use is the signal that a tool is missing, so every path that
 *  has a tool now names it, and the one path that could never fit the
 *  delivery cap (a raw battle log, review 4.3) is refused before the lane
 *  and the CR budget are spent. */

import { normalizeTag, responseMeta } from "@elixir-mcp/contracts";
import { livePathToJob } from "../live.mjs";
import {
  ToolFailure,
  spendLiveQuota,
  appliedBlock,
  notes,
  docsRef,
} from "./shared.mjs";

/** The recorded-data tool that answers the same question as each path,
 *  so the raw read stays the last resort. */
const RECORDED_ALTERNATIVE = {
  player:
    "players_profile({ player_tag, live: true }) returns the same profile projected and recorded",
  clan: "clans_roster({ clan_tag, live: true }) returns the same roster projected and recorded",
  currentriverrace:
    "war_current({ clan_tag, live: true }) returns the same race projected, with decks_today and the policy clock",
  riverracelog: "war_history({ clan_tag }) once the clan is recorded",
};

export const liveTools = {
  live_fetch: {
    description:
      "The catch-all: one allowlisted raw GET against the CR API through the live lane (per-account daily quota, spends the shared CR budget). Paths: /players/{tag}, /clans/{tag}, /clans/{tag}/currentriverrace, /clans/{tag}/riverracelog, /locations/{id}/rankings/players, /locations/{id}/pathoflegend/players. Prefer the recorded tools, all of which take live: true where a fresh read matters; /players/{tag}/battlelog is refused (a raw log exceeds the delivery cap): use battles_query({ live: true }). RAW payload: card levels are the API's rarity-relative scale.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "e.g. /players/#20JJJ2CCRU or /clans/#J2RGCRVG/currentriverrace",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const job = livePathToJob(String(args.path ?? ""), normalizeTag);
      if (job.error) throw new ToolFailure(job.error, job.message);
      if (job.endpoint === "player_battlelog") {
        throw new ToolFailure(
          "result_too_large",
          "A raw battle log exceeds the 48,000-character delivery cap, so this path would spend a live fetch and deliver nothing.",
          `battles_query({ player_tag: "${job.entityKey}", live: true }) polls the log once and answers from the record in the compact shape.`,
        );
      }
      if (!ctx.live) {
        throw new ToolFailure(
          "live_unavailable",
          "The live lane is not configured here.",
          "Recorded-data tools remain available.",
        );
      }
      await spendLiveQuota(ctx);
      const result = await ctx.live(ctx.db, job);
      if (!result.ok) {
        throw new ToolFailure(
          "live_unavailable",
          result.reason === "rejected"
            ? "The live fetch returned a payload our admission rejected."
            : "No gateway completed the live fetch in time.",
          "The recorded-data tools remain available; try again shortly.",
        );
      }
      return {
        path: String(args.path),
        live: true,
        applied: appliedBlock({
          path: String(args.path),
          endpoint: job.endpoint,
          entity: job.entityKey,
        }),
        data: result.payload,
        notes: notes(
          RECORDED_ALTERNATIVE[job.endpoint]
            ? `A recorded tool answers this path: ${RECORDED_ALTERNATIVE[job.endpoint]}.`
            : null,
          "Raw payload: card levels are the API's rarity-relative scale (a maxed legendary reads 8/8); the fetch was recorded opportunistically.",
        ),
        docs: docsRef("recording", "reading-the-game-live"),
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },
};
