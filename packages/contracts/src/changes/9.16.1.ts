import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.16.1",
  date: "2026-09-28",
  summary:
    "`clans_participation` answers the table form (9.16.0) to an agent on a service token too. 9.16.0 laid out the table only for a person's or an OAuth agent's MCP connection, so a service-token agent still read object rows and its eight-week full read still refused. Correction; nothing else moved.",
} satisfies ChangelogEntry;
