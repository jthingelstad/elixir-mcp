import { normalizeTag, responseMeta } from "@elixir-mcp/contracts";
import {
  TAG_RULE_HINT,
  ToolFailure,
  appliedBlock,
  docsRef,
  notes,
} from "../shared.mjs";

export const elixir_nickname = {
  description:
    "Give a player YOUR nickname, private to your account and visible only to you and your agents ('to me Raquaza is Tyler'). Nicknames ride along wherever names appear (search matches them, summaries and rosters show them). Pass nickname: null to clear.",
  inputSchema: {
    type: "object",
    properties: {
      player_tag: {
        type: "string",
        description: "The tag to nickname, like #9L0V2QPC.",
      },
      nickname: {
        type: ["string", "null"],
        maxLength: 40,
        description: "Your name for them; null clears it.",
      },
    },
    required: ["player_tag", "nickname"],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    let tag;
    try {
      tag = normalizeTag(String(args.player_tag ?? ""));
    } catch {
      throw new ToolFailure(
        "invalid_tag",
        "Invalid player tag.",
        TAG_RULE_HINT,
      );
    }
    if (args.nickname === null || String(args.nickname).trim() === "") {
      const { rowCount } = await ctx.db.query(
        `delete from player_nickname where account_id = $1 and player_tag = $2`,
        [ctx.account.accountId, tag],
      );
      return {
        player_tag: tag,
        nickname: null,
        cleared: rowCount > 0,
        applied: appliedBlock({ player_tag: tag, action: "clear" }),
        docs: docsRef("recording", "relationships-primary-nicknames"),
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    }
    const nickname = String(args.nickname).trim().slice(0, 40);
    await ctx.db.query(
      `insert into player_nickname (account_id, player_tag, nickname)
         values ($1, $2, $3)
         on conflict (account_id, player_tag) do update set nickname = excluded.nickname`,
      [ctx.account.accountId, tag, nickname],
    );
    return {
      player_tag: tag,
      nickname,
      applied: appliedBlock({ player_tag: tag, action: "set" }),
      notes: notes(
        "Private to your account: your agents see it in search, summaries and rosters; nobody else does.",
      ),
      docs: docsRef("recording", "relationships-primary-nicknames"),
      meta: responseMeta({ as_of: new Date().toISOString() }),
    };
  },
};
