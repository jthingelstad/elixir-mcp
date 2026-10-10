import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "10.0.0",
  date: "2026-10-02",
  summary:
    "Named recording Collections have retired. Elixir records players and clans followed directly by accounts. Primary, alt, friend and watching relationships, owned card collections, notifications and personal OAuth tracking remain. Drop no longer automatically enrolls players. Historical Collection membership is retained for the reviewed data purge.",
  breaking:
    "collections_browse, collections_get and collections_edit are removed, as is segment.collection. collections:write is no longer offered or issued; existing grants retain their remaining scopes. JSON API 3.0.0 removes the two collection-add operations without replacing them. Refresh cached tool declarations.",
} satisfies ChangelogEntry;
