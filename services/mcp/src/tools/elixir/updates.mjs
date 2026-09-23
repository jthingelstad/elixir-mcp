import { responseMeta } from "@elixir-mcp/contracts";
import { CORPUS_BUILT_AT, UPDATES } from "@elixir-mcp/docs";
import { ToolFailure, appliedBlock, docsRef, notes } from "../shared.mjs";

export const elixir_updates = {
  description:
    "What's new on Elixir MCP: every user-visible change, newest first, as written for people at elixir.poapkings.com/updates. Distinct from elixir_changelog (the tool contract version by version). since: entries on or after a date; limit: how many.",
  inputSchema: {
    type: "object",
    properties: {
      since: {
        type: "string",
        description: "YYYY-MM-DD; entries from that day on, newest first.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 50,
        default: 10,
      },
    },
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const since = args.since ? String(args.since).slice(0, 10) : null;
    if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since))
      throw new ToolFailure("bad_request", "since must be YYYY-MM-DD.");
    const limit = Math.min(50, Math.max(1, Number(args.limit ?? 10)));
    const all = since ? UPDATES.filter((u) => u.date >= since) : UPDATES;
    return {
      applied: appliedBlock({ since: since ?? undefined, limit }),
      total: all.length,
      entries: all.slice(0, limit),
      notes: notes("The tool contract's own history is elixir_changelog."),
      // Every answer points at a page (Gym #123, #167).
      docs: docsRef("about"),
      corpus_built_at: CORPUS_BUILT_AT,
      meta: responseMeta({ as_of: new Date().toISOString() }),
    };
  },
};
