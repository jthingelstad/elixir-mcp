import { responseMeta } from "@elixir-mcp/contracts";
import { myPlayers } from "@elixir-mcp/record/players";
import { docsRef, notes } from "../shared.mjs";

export const elixir_my_players = {
  description:
    'The players you track and WHO EACH ONE IS TO YOU: relationship (primary | alt | friend | watching), your private nickname if any, notify setting, recording status and current clan. That is what resolves "my alt" or "how are my friends doing" without asking. You do NOT need this to answer questions about yourself: omit player_tag and the tools already mean your primary.',
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  async handler(ctx) {
    return {
      players: await myPlayers(ctx.db, ctx.account.accountId),
      notes: notes(
        "Omit player_tag on any tool to mean your primary; name a tag only for somebody else.",
      ),
      docs: docsRef("recording", "relationships-primary-nicknames"),
      meta: responseMeta({ as_of: new Date().toISOString() }),
    };
  },
};
