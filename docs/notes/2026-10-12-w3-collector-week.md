# 2026-10-12 — The collector week is Saturday to Saturday (#536, stage 4's first move)

No contract move: the collector week reaches no MCP tool or `/api/v1`
shape (it lives in the jobs Lambda's mail and nowhere else). No
migration. The send stays Sunday 14:00 UTC (`MAIL_SCHEDULE`, the
EventBridge cron), so no infrastructure change.

## Jamie's answers

Issue #536, on the collector-week question [Jamie, 2026-10-12]:

> Good catch -- since we send that on Sunday and I like that, let's do
> 0:00 UTC Sat to Sat.

Issue #536, on the milestone once-a-day question [Jamie, 2026-10-12]:

> there is no hard 1 a day… however, SCHEDULED emails we are
> intentionally only doing one a day. On demand/event based emails are a
> completely different thing and flow whenever they flow.

The first is built here; the second needs nothing built (DECISIONS
"Seven product kinds" already exempts milestone and feedback answers),
so it is worded into the mail brief's principle 3, a DECISIONS line and
the public email page.

## The window

`lastCollectorWeek` (`services/jobs/src/email/week.mjs`): `to` is the
most recent Saturday 00:00Z at or before now, `from` seven days before.
The Sunday 14:00Z send covers the week that closed 38 hours earlier.
`buildCollector` reads `api_receipt` with `fetched_at >= from and
fetched_at < to`, unchanged; its coverage sentence now names the
Saturday boundaries.

## Product questions and the answers taken

1. **What do the dates in the subject say?** [engineering, 2026-10-12]
   The days the week holds, Saturday to Friday ("Oct 10 – 16"). The game
   week's label ends on the Monday it closes on because its last hours
   are that Monday morning; a week that closes at Saturday 00:00Z holds
   no hour of the Saturday, so naming it would claim a day the mail does
   not count.
2. **Does the period key stay one per week across the switch?**
   [engineering] Yes, with no change to it: the key is the ISO week of
   the week's start plus `c`, and a Saturday shares its ISO week with
   the Sunday after it. The last Sunday week (sent 2026-10-11, from
   Sunday 2026-10-04) is `2026-W40c`; the first Saturday week (sent
   2026-10-18, from Saturday 2026-10-10) is `2026-W41c`, so the ledger
   sends it and never reads it as already sent. Pinned in
   `services/jobs/test/email.test.mjs`.
3. **The one-time overlap.** [engineering, accepted in the step brief]
   The 2026-10-11 mail covered Sunday 2026-10-04 14:00Z to Sunday
   2026-10-11 14:00Z; the 2026-10-18 mail covers Saturday 2026-10-10
   00:00Z to Saturday 2026-10-17 00:00Z. The 38 hours from Saturday
   2026-10-10 00:00Z to Sunday 2026-10-11 14:00Z are counted in both,
   once. No bridge is built: it would need the last send's window from
   the ledger for one mail. The What's new entry says so.
4. **Issues stored before the switch.** They render as stored: the label
   and coverage sentence are in the stored facts, so an old record
   still says Sunday to Sunday, which is what it counted.
5. **Which kinds are scheduled?** [Jamie's list, from the #536 thread]
   Clan report, friends, Arena week, collector and actions waiting are
   one a day of a kind about one subject; milestones and answers to
   feedback flow when they happen. Nothing in code changes: the rule was
   already built this way; only the words said "one a day" with a
   milestone exemption and no mention of feedback answers.

## Not in this change

The collector health item and recomposing the collector mail over the
timeline (stage 4's next moves), and the timeline composer
(`digest.mjs`, stage 1). The game week (`lastGameWeek`, Monday 10:00Z)
and every other kind's window are unchanged. #536 stays open.
