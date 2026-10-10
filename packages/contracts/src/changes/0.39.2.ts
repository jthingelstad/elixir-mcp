import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.39.2",
  date: "2026-09-09",
  summary:
    "Arguments are validated against each tool's declared inputSchema before the handler runs: an unknown property, a wrong type, a value outside enum/minimum/maximum/length bounds, or a missing required argument is refused with bad_request naming the argument, never silently ignored or clamped (a limit above the declared maximum is now refused rather than reduced; limit_applied still echoes an in-range value). players_search treats %, _ and \\ in the query literally. The website's explorer bridge is metered like the MCP door (hourly rate limit, daily quota, result cap) and serves read-only tools.",
} satisfies ChangelogEntry;
