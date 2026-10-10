import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.7.2",
  date: "2026-10-10",
  summary: md(
    'A departure\'s sentence no longer says a member left when they may have been removed (Jamie: a kick is "was removed", never "left", wherever the timeline is told).',
    list(
      "elixir_timeline: member_left and clan_left say the member departed, since the roster cannot tell a leave from a kick; a leader's departure_classified says the member was removed (a kick) or left on their own. The tracking mail's clan moves say the same.",
    ),
    "Wording only: kinds, facts and the kick/leave values are unchanged. JSON API 3.1.0 is unchanged.",
  ),
} satisfies ChangelogEntry;
