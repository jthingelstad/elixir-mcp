import { responseMeta } from "@elixir-mcp/contracts";
import { readAgentPolicyContext } from "@elixir-mcp/auth/clan-context";
import { ToolFailure, docsRef, notes } from "./shared.mjs";

export const clanContextTools = {
  clans_context: {
    description:
      "Your assigned clan’s explicit war participation intent and policy revision, for an agent with a separately approved private-context grant. No clan argument: the current assignment, actual owner and verified current membership are checked on every read. Unknown intent is never a participation decision. Refresh at startup, before planning and immediately before firing an affected routine; defer that routine on unknown or error. No scoring, notes, member decisions or other private policy fields.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async handler(ctx) {
      const context = await readAgentPolicyContext(ctx.db, ctx.account);
      if (!context)
        throw new ToolFailure(
          "not_entitled",
          "Private clan context is not authorized.",
          "A separately approved grant and current verified owner membership are required; game read scopes and tracked clans do not grant policy access.",
        );
      return {
        context,
        applied: {},
        notes: notes(
          "policy_saved_at is save provenance; read_at times this current read. Unknown or failed context must defer the affected routine.",
        ),
        docs: docsRef("clan-policy", "agent-context"),
        meta: responseMeta({ as_of: context.read_at }),
      };
    },
  },
};
