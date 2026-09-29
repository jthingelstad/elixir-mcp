import { responseMeta } from "@elixir-mcp/contracts";
import { docsRef, notes } from "../shared.mjs";

export const elixir_my_identities = {
  description:
    "The humans you have learned, and which player each one is. Yours alone; one connection's mappings are invisible to every other. Useful for 'who am I to you?' and for spotting a mapping you got wrong.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  async handler(ctx) {
    const { rows } = await ctx.db.query(
      `select ai.external_id, ai.player_tag, p.name, ai.created_at
         from agent_identity ai
         left join player p on p.player_tag = ai.player_tag
         where ai.account_id = $1
         order by ai.created_at`,
      [ctx.account.accountId],
    );
    return {
      identities: rows.map((r) => ({
        external_id: r.external_id,
        player_tag: r.player_tag,
        name: r.name,
        created_at: r.created_at?.toISOString() ?? null,
      })),
      // notes on every read (Gym #123): the one-size sentence for a
      // compact call rides on them, and an empty list says what to do.
      notes: notes(
        rows.length === 0
          ? "No humans are mapped on this connection yet; elixir_identify maps one, and on_behalf_of then resolves them."
          : "external_id is the id you passed to elixir_identify; pass it as on_behalf_of and 'how am I doing' resolves to that player.",
      ),
      docs: docsRef("agents", "knowing-which-human-is-asking"),
      meta: responseMeta({ as_of: new Date().toISOString() }),
    };
  },
};
