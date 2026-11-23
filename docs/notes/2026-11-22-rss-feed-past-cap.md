# 2026-11-22 — The RSS feed builds its own week when Home's was cut short

Codex's review of #1188 (the RSS feed reads Home's stored week) found a
week the stored row cannot answer. Home's week is capped at 150 items, and
the cap counts people lines and leaders-only facts, which the feed then
drops. The feed's old build left those out before the cap. So in a week
where the cap cut Home's row and most of what it kept is not the feed's to
carry, the feed could miss battles and sittings it used to serve, and a
rebuild would cut the same ones.

`readFeedWeek` now checks for that week: when the row says it was cut
(`more` above zero) and holds fewer stories than the feed serves (50,
`FEED_ITEMS`), the poll builds the feed's own week from the record, as
every poll did before #1188. When the row holds 50 stories or more, the
ones the cap took are older than any the feed would serve, and the row
answers. Home's row is not rewritten by the fallback.

This costs a build per poll only for an account whose week holds more than
150 items of which over 100 are people lines or leaders-only facts. A test
gives a cut row one story and holds the feed to the record
(`packages/tools/test/feed-week.test.mjs`).

Ships before #1188 reached production. MCP and JSON API unchanged. No
migration.
