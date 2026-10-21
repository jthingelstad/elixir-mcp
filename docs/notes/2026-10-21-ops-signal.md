# 2026-10-21 — An incident pages once; throttles alarm; fifteen-minute checkpoints

From the platform review of 2026-10-21 (ops signal). Every alarm's 14
days of history was read against its shape; times are US Central.

**Door handled failures.** The elixir_timeline nowMs defect failed every
war-day timeline from 10-15 05:20 to 10-16 05:25. The failures came every
40 minutes, then about every five from 09:00, and a ten-minute sum at 3
swung across the threshold: 42 ALARM entries for one incident, the first
at 09:41. The alarm now sums an hour and pages on 1 of 2 hourly
datapoints. Any third failure in 60 minutes pages within a minute, never
later than the ten-minute shape did, and the second period holds ALARM
across a quiet half hour. Replayed over that day, it pages once, at
09:06, and clears about two hours after the last failure. Outside that
incident the door logged one handled failure in 14 days.

**Season war-id mismatch.** The evidence arrives with a clan's river race
log, about once a day, so 1 of 1 hourly datapoints sat in ALARM for three
hours after each read and paged again on the next: 14 pages from 10-08
to 10-16 for one standing defect (issue #593, fixed 10-17). It now pages
on the first mismatched read, as before, and holds ALARM for 30 hours
(1 of 30 hourly datapoints).

**The rest of the alarms.** `jobs-errors` paged 10 times, each a real
nightly failure (issue #592, fixed 10-16). `collector-errors` paged twice
and `dlq-timeline-sync` once, each separate. `mcp-latency-p95` paged 8
times from 10-07 to 10-13: mostly isolated, plus three in 32 minutes on
10-12. The MCP log's request lines begin 10-13, so that cluster cannot
be replayed, and its shape is unchanged. Every one of the 28 alarms
publishes only to `elixir-mcp-alarms` and states its missing-data
treatment; `infra-controls.test.mjs` pins the three new shapes and those
rules.

**Door throttles.** `elixir-mcp-door-throttles` is new. It sums the
standard `EndpointActiveEnvironmentThrottles` (MaxEnvironments) and
`EndpointRequestThrottles` (RateLimit) in `AWS/Lambda/Web/Usage` for the
three doors and pages on 3 of 6 five-minute periods. No custom metric is
added. In 14 days only the web-api throttled: fifteen five-minute bursts
of 1 to 29 requests, the scanner waves #451 is about, each over in one
period. Replayed, the alarm never pages on those bursts and pages once
15 to 25 minutes into a sustained episode. The dashboard gains a "Doors:
requests throttled (429)" widget (39 metrics of 50). Whether the web-api
should run more than two environments is a cost call, Jamie's.

**The timeline-sync dead letters.** The DLQ peak of 596 had the same
cause. From war day 1 (10-15 05:18) every sync wake built the clan's
entry and threw the ReferenceError. With ReportBatchItemFailures each
message failed its five receives without counting a Lambda error, and
dead-lettered: 25 to 35 an hour until the fix (MCP 11.13.1, 10-16 about
05:20). The DLQ alarm fired at 05:55 on 10-15, 35 minutes in. The 596
were redriven at 05:35 on 10-16, once the fix was live, and all of them
synced. The DLQ is empty, and no redrive is outstanding. The sync's
retry line logged only the error's kind, and the cause was read from
the MCP door's log; it now logs the message too
(`timeline_sync_retry <kind> <message>`).

**Acceptance on a war day.** The failure lasted a day because no
acceptance run read a timeline while a war day was being played: the
deck tally runs only then. The new case
`contracts/timeline-war-day-in-progress` makes the agents' compact poll
(`days: 1, basis: occurred, mark_read: false`), which must answer. It
then reads two days in full: while a war day is in progress and the race
is not finished, the clan's `war.decks` must be served and add up
(untouched + partial + finished = participants > 0), with `as_of` inside
the window. On any other day it is skipped, and the skip says why. It
reads as the acceptance principal with `mark_read: false`. Its bite is
the 10-16 capture of that poll answering `internal` on 11.13.0.

**Checkpoints.** `checkpoint_timeout` is now 900 s, set in the stack's
parameter group, up from the engine's 300. The database ran 288 timed
checkpoints a day of a few hundred buffers each. Every page first
touched after a checkpoint is written to the WAL whole, so fewer
checkpoints mean fewer full-page writes. The parameter is dynamic and
applies without a reboot, and the group's Description is unchanged
(changing it replaces the group). The WAL volume, 64 MB every five
minutes, comes from RDS's `archive_timeout` of 300 s, a system value
this cannot change. Expect about 96 checkpoints a day and no change in
`TransactionLogsGeneration`.

No MCP or JSON API version changes.
