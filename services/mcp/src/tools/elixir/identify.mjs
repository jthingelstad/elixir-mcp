import { normalizeTag } from "@elixir-mcp/contracts";
import {
  TAG_SCHEMA,
  ToolFailure,
  appliedBlock,
  buildMeta,
  docsRef,
  notes,
} from "../shared.mjs";

export const elixir_identify = {
  description:
    "Remember which player a human is, so you never have to ask twice. An agent serves many people through one connection and MCP carries no per-request identity, so YOU supply one: discord:1234, signal:..., telegram:..., whatever your surface has. Pass that same id as on_behalf_of afterwards and 'how am I doing' resolves with no lookup. The mapping is yours alone and confers nothing (recorded reads are open to every account); it only picks a default subject. Call it once, right after they tell you who they are.",
  inputSchema: {
    type: "object",
    properties: {
      external_id: {
        type: "string",
        maxLength: 200,
        description:
          "The id this human has on your surface; namespace it however you like, it is opaque here.",
      },
      player_tag: {
        ...TAG_SCHEMA,
        description: "The player they say they are.",
      },
    },
    required: ["external_id", "player_tag"],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const externalId = String(args.external_id ?? "").trim();
    if (!externalId)
      throw new ToolFailure("bad_request", "external_id is empty.");
    const tag = normalizeTag(String(args.player_tag ?? ""));

    // They must be someone you actually cover: a wrong mapping answers
    // confidently about the wrong person every time afterwards.
    const { rows: member } = await ctx.db.query(
      `select cm.clan_tag from clan_membership cm
         join account_clan ac on ac.clan_tag = cm.clan_tag
         where ac.account_id = $1 and cm.player_tag = $2 and cm.left_observed_at is null
         limit 1`,
      [ctx.account.accountId, tag],
    );
    if (!member[0]) {
      throw new ToolFailure(
        "not_entitled",
        `${tag} is not a current member of a clan on this connection.`,
        "Check the tag with players_search. Identities are for the people you serve.",
      );
    }

    await ctx.db.query(
      `insert into agent_identity (account_id, external_id, player_tag)
         values ($1, $2, $3)
         on conflict (account_id, external_id)
         do update set player_tag = excluded.player_tag, created_at = now()`,
      [ctx.account.accountId, externalId, tag],
    );

    const { rows: who } = await ctx.db.query(
      `select name from player where player_tag = $1`,
      [tag],
    );
    return {
      external_id: externalId,
      player_tag: tag,
      name: who[0]?.name ?? null,
      clan_tag: member[0].clan_tag,
      applied: appliedBlock({ external_id: externalId, player_tag: tag }),
      notes: notes(
        "Pass this external_id as on_behalf_of from now on; omit player_tag and it means them.",
        "Mapping the same external_id again replaces the earlier player.",
      ),
      docs: docsRef("agents", "knowing-which-human-is-asking"),
      meta: await buildMeta(ctx.db, ctx.account, tag),
    };
  },
};
