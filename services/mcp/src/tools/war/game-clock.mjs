import { gameClock } from "../../../../ingest/src/game-clock.mjs";
import { responseMeta } from "@elixir-mcp/contracts";
import { ToolFailure, appliedBlock } from "../shared.mjs";
import { CLOCK_DOCS } from "./common.mjs";

export const game_clock = {
  description:
    "What time it is in Clash Royale, for nobody in particular: current season, week within the season, whether today is a training day or war day, when this day ends, and the next boundaries of each kind (war_day_closes_at, next_war_day_opens_at, next_training_starts_at, week_ends_at, season_ends_at) so a routine can schedule itself. Needs no player and no clan. Use it to decide WHEN to look before deciding who to look at; war_current is the tool for what a specific clan is doing inside this day.",
  inputSchema: {
    type: "object",
    properties: {
      at: {
        type: "string",
        description:
          "ISO 8601 instant to describe instead of now, e.g. to learn what day a recorded battle fell on.",
      },
    },
    additionalProperties: false,
  },
  async handler(_ctx, args = {}) {
    let atMs = Date.now();
    if (args.at !== undefined) {
      const parsed = Date.parse(args.at);
      if (Number.isNaN(parsed))
        throw new ToolFailure(
          "bad_request",
          `Could not read '${args.at}' as a date.`,
          "Use an ISO 8601 instant, e.g. 2026-09-08T12:00:00Z.",
        );
      atMs = parsed;
    }
    const clock = gameClock(atMs);
    return {
      ...clock,
      applied: appliedBlock({ at: new Date(atMs).toISOString() }),
      docs: CLOCK_DOCS,
      meta: responseMeta({ as_of: new Date().toISOString() }),
    };
  },
};
