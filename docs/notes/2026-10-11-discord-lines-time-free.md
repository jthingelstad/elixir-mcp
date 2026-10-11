# 2026-10-11 — Discord lines carry no time unless the item is old

No MCP or JSON API change. No migration.

Jamie, 2026-10-11: "Approved: remove the leading event time from the
timeline cross-post and Clan activity lines in elixir-mcp, keeping a
relative time only for items over 3 hours old".

- **What:** `discordLine` (`packages/syndication/src/lines.mjs`), the one
  builder both the timeline cross-post and a clan's activity channel use,
  no longer opens a line with `<t:unix:t>` (under 12 hours) or
  `<t:unix:f>`. An item three hours old or less when the line is built
  carries no time: Discord's post time is enough. An older one gets a
  relative stamp, `<t:unix:R>`, after its sentence and before its links.
- **Edits:** an edit builds the line again, so the rule is recomputed.
  A sitting's age runs from its last battle (`facts.ended_at`), not its
  start: a sitting edited as it grows, or closed within the usual 45
  minutes, stays time-free. Before, Vijay's sitting showed "3:41 PM" on
  a 2:33 PM message after an edit. A stamp is never a clock time now, so
  it cannot read later than its message.
- **Leading markdown:** the stamp used to keep a name that opens the line
  from reading as markdown. The line now starts with its sentence, so a
  leading `#`, `-` or `1.` is escaped.
- **Not changed:** the item's sentence stays time-free; the first line a
  new webhook receives still says from when it posts; the Clan path is
  as it was (the activity channel's rebuild rebases on this).
- DECISIONS: the cross-post and the Clan activity lines say it.
