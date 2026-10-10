import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.16.0",
  date: "2026-09-28",
  summary: md(
    "`clans_participation` answers an agent as a table (#124), so the eight-week read of a full clan with the members who left fits the response cap with room. Since 9.13.0 the eight-week full read of the recorded clan had refused with `result_too_large` (51,875 characters), and compact answered about 1,000 under it.",
    list(
      "Over MCP each `members` and `former_members` row is an array, and the new `columns.members` and `columns.former_members` name its entries once, in order. The keys a list of objects repeats on every row were two fifths of the answer.",
      "In the table an instant on a whole second is written without its `.000`, and `in_clan_at_war_finish` with `role_at_war_finish` is one column, `place_at_war_finish`: the role at the finish where it is known, else `true` in the clan or `false` not in it, else `null`, unknown.",
      "Nothing is dropped: every row reads back to exactly the object the JSON API serves. A 50-member clan with 20 departures answers the eight-week read in under 40,000 characters at either verbosity, and a test holds it there.",
    ),
    "The JSON API (2.7.1) and the console still serve object rows; only the shared schema moved.",
  ),
  breaking:
    "clans_participation over MCP: members and former_members rows are arrays named by columns, not objects, and place_at_war_finish replaces in_clan_at_war_finish and role_at_war_finish in them. The values are the same.",
} satisfies ChangelogEntry;
