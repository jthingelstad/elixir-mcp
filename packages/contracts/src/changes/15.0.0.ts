import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "15.0.0",
  date: "2026-11-19",
  summary: md(
    "Player and clan connections now discover their tools through current MCP clients and the legacy handshake.",
    list(
      "Use elixir_timeline with scope home_clan to read just your home clan, with independent read positions. clans_directory accepts an exact clan_tag and returns the public policy version.",
      "Personal connections receive posts_pending for visible new or edited posts. Read kinds [post] for posts with battle attachments under the same item ID. elixir_cheers includes eligible authored posts and counts other people's reactions.",
      "The server supports 2026-07-28 discovery and private cache hints. Discover tools using tools/list with the credential that will call them.",
    ),
    "JSON API 6.0.0 is unchanged.",
  ),
  breaking:
    "elixir_cheers is personal-only. Connect at /mcp to read your own cheers. A clan connection can no longer read its owner's reactions.",
} satisfies ChangelogEntry;
