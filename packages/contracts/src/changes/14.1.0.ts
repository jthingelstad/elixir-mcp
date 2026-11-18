import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "14.1.0",
  date: "2026-11-18",
  summary: md(
    "Posts may carry their author's own recorded game achievement, selected from the Timeline and verified again when the post is created.",
    list(
      "A person's elixir_timeline post facts now include nullable moment: the original canonical game item id, kind, at, player_tag, factual text and game-only item_ref. This is an immutable attachment to the author's words, not new game record or client-supplied facts.",
      "Mastery and badge levels, promotions, new bests, collection and career steps, card unlocks/forms/max levels/first wins, King Tower levels and challenge achievements are supported. Private Clan state, People events, sessions and other posts cannot be attached.",
      "Existing post audiences, blocks, moderation and delivery choices still apply. Posts remain followers-only and publishable:false in MCP and private RSS. This adds no tool, write capability or JSON API field.",
    ),
    "Additive MCP minor approved by Jamie for milestone posts on 2026-11-18. JSON API 6.0.0 is unchanged.",
  ),
} satisfies ChangelogEntry;
