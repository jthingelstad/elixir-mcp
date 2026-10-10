import { md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.12.2",
  date: "2026-09-27",
  summary: md(
    "Every database read is bounded (review §3.1-3.3). A read-only tool waits at most 5 s for a lock and answers `query_timeout` instead of holding a connection behind a migration. `battles_deck_sets` and `battles_deck_upgrades` stop their search at a 4 s time budget as well as the node budget, so `exhausted: false` can mean either; the values are the best found. Explore and `/api/v1` now race the same read deadline MCP does, so a slow read answers `query_timeout` there too rather than timing out the request.",
  ),
} satisfies ChangelogEntry;
