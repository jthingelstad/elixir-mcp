import { responseMeta } from "@elixir-mcp/contracts";
import { docsRef, notes } from "../shared.mjs";

export const elixir_my_identities = {
  description:
    "The humans this connection mapped to players before 12.0.0, and which player each one is; on_behalf_of still resolves them. Yours alone; one connection's mappings are invisible to every other. New humans are known by their Discord link (on_behalf_of discord:<user id>), never a new mapping.",
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
          ? 'No humans are mapped on this connection. A person who links Discord in their Elixir Settings is known by on_behalf_of: "discord:<their user id>"; otherwise pass player_tag.'
          : "external_id is the id mapped before 12.0.0; pass it as on_behalf_of and 'how am I doing' resolves to that player. New humans are known by their Discord link, never a new mapping.",
      ),
      docs: docsRef("agents", "knowing-which-human-is-asking"),
      meta: responseMeta({ as_of: new Date().toISOString() }),
    };
  },
};
