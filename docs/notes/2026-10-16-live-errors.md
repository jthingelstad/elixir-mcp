# 2026-10-16 — Four live errors: the activity rebuild, the war-season check, suppressed mail, the flip's connections

Four defects production reported, fixed together on Jamie's word ("fix
things that you found that are errors or security issues"). No contract,
JSON API or migration moves; nothing a tool serves changes.

## The nightly activity rebuild failed every night (#592)

From 2026-10-08 the 05:30Z `{activity_histogram}` run threw on
`player_activity_player_tag_fkey`, three attempts a night. The jobs log
named one tag every time. `{tag_footprint}` showed its shape: a claim
recording, stopped, a `claim_added` account event, and no `player` row,
which the untracked trim (`tracked_purge`, 2026-10-07) had removed. The
rebuild's player list read recordings and account events, not the
record, so it still listed the tag, and the insert's foreign key refused
it. The run is one row at a time with no transaction, so each night wrote
the rows before that tag and none after, and the archetype stamp that
rides the same invocation never ran.

`recordedPlayers` now requires the tag's `player` row. The regression in
`services/jobs/test/activity.test.mjs` builds the production shape on a
scratch database; it failed with the production error before the fix.
The row is a nightly projection rebuilt whole each run, so the missed
nights need no backfill: the first run after the deploy rebuilds every
row.

## The war-season check alarmed on a correct calendar (#593)

`elixir-mcp-season-war-id-mismatch` fired on every river race log read
from two clans since 2026-10-08, the season row's war id one ahead of
the log for 2026-08, 09 and 10. The payload archive answered it: those
clans' last races of seasons 135 and 136 closed at 10:06Z on 2026-09-07
and 10:10Z on 2026-10-05, minutes after the 10:00Z season roll, because
a race closes on the clan's own reset. The check placed each season's
newest log entry by its close instant, so a final race that closed after
the roll landed in the next season's row. The calendar is right: every
earlier race of those seasons sits inside its own row.

`verifyWarSeason` now places a race by the day before its close, its
last battle day, which no reset drift passes. Nothing needs repair: a
mismatch never wrote, `war_week` keys on the API's own `seasonId`, and
the season rows' war ids agree with the log once each race is placed in
the season it raced. The regression in
`packages/ingest/test/season.test.mjs` takes the two observed closes.

## Mail to a suppressed address

The 09:00 CT mail kept sending to an address on SES's account
suppression list (five `OnAccountSuppressionList` bounces), beside one
permanent bounce, which the configuration set lists in turn. SES delivers nothing to a
listed address but accepts the send and answers each with a bounce to
the ops queue. The relay now asks the list before every send and skips
a listed address, logging `mail_suppressed <kind> <send_id> <issue_key>
<reason>`, never the address (docs/EMAIL.md). A failed lookup sends as
before. Nobody's switches change; an address that leaves the list is
mailed again. The relay role gains `ses:GetSuppressedDestination`.

## The revision flip's 5xx

On 2026-10-13 each of four revision flips cost a few requests across
mcp, web-api and collector a 2.5 s wait and a 5xx: fresh environments
opening their first connections at once, past `connectionTimeoutMillis`.
A lease now tries once more for a connection that never opened (pg's
"Connection terminated due to connection timeout", or a refused or
reset socket) and logs `db_connect_retry`. A full pool is not retried,
so load never queues longer, and one retry stays inside every door's
deadline.
