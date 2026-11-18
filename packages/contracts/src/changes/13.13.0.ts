import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "13.13.0",
  date: "2026-11-18",
  summary: md(
    "A person's own Timeline includes visible plain posts and questions from their existing follow audience.",
    list(
      "elixir_timeline adds post/1 in the posts section: authored words, question and answered flags, normalized deck/cards and a signed-in member URL. Visibility is followers and publishable is false. Clan-agent principals never receive plain posts, including through on_behalf_of.",
      "Observed polls include edits as the same item at a higher revision; occurred reads keep the creation time. Post filters, skip_empty, item/character caps and continuation counts use the authorized audience. Comments and public share URLs are never included or created.",
    ),
    "Additive MCP change. JSON API 5.1.0 is unchanged.",
  ),
} satisfies ChangelogEntry;
