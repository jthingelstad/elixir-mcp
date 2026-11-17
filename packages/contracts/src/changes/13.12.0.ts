import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "13.12.0",
  date: "2026-11-17",
  summary: md(
    "Public sharing now uses opaque links to one Timeline item. Members share in the app; agents still read the social layer and never publish it.",
    list(
      "`battles_query`: each row's `url` and its `.png` picture require a signed-in account. Battle addressing and result fields are unchanged. Existing anonymous battle and session data routes are retired.",
      "`elixir_timeline`: a battle post's existing `facts.share_url`, when present on the author's read, is now its current `/share/<id>` capability. Old `/h/` links are retired. An unshared post has no `share_url`; no link is created by an MCP read.",
    ),
    "Link access changes approved by Jamie on 2026-11-17. The JSON API is unchanged at 5.1.0.",
  ),
} satisfies ChangelogEntry;
