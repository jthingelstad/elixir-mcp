/** live_fetch — moved verbatim from the
 *  single-file registry (review item 8). */

import { normalizeTag, responseMeta } from "@elixir-mcp/contracts";
import { livePathToJob } from "../live.mjs";
import { ToolFailure, spendLiveQuota } from "./shared.mjs";

export const liveTools = {
  live_fetch: {
    description:
      "Allowlisted live GET passthrough to the CR API through the recording budget (tight per-account quota): /players/{tag}, /players/{tag}/battlelog, /clans/{tag}, /clans/{tag}/currentriverrace, /clans/{tag}/riverracelog, /locations/{id}/rankings/players and /locations/{id}/pathoflegend/players (id: 'global' or numeric; top-100, ranked tags accrete into the corpus). Fetched results are recorded opportunistically. Expect 1–3s. RAW payloads: card levels here are the API's rarity-relative scale (a maxed legendary reads 8/8); every recorded-data tool serves the in-game 1-16 scale instead.",
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
        data: result.payload,
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },
};
