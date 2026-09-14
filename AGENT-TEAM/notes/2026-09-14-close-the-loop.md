# Close the Loop — September 14 morning

Reviewed `e28abf8`, current deployed contract 3.0.0 and decisions since
`c7d9950`. Initial preflight: observation available, clean synchronized main,
no lease or queued notes. Claimed loop lease
`2a6721f2-4cff-4046-86b2-3dc8c1b62049` immediately before edits.

## Measured gap and source work

Migrate `feedback_pending` at 11:46Z: four items, #35–#38, oldest 23h15m,
none over the one-day response target. The old operation exposed only new
status, unbounded id order and no current response. Regression first:
27 rows rather than the required oldest 25. The reader now counts unanswered
items at every status, reports oldest age/overdue count and returns 25 by
created time then id. `feedback_read` supplies current status/response without
consuming the requester's inbox; an optional expected-state check blocks stale
reply replay, and response plus account event are transactional. Scratch-DB
regression covers the read/write/read round trip, stale replay refusal and a fresh follow-up.
A further failing regression found Date millisecond rounding rejected an exact
PostgreSQL microsecond timestamp; the operations read-back now retains full
UTC precision. The precision fix shipped as bfbee73 and passed the full gate
and deployment smoke before replying.

Final acceptance also caught discovery's freshness lookup using `catalog`
rather than the scheduler's `GLOBAL` key. A scratch regression reproduced
the unknown freshness despite a known admission; discovery now reads the
catalog's actual source poll clock.

Live 3.0.0 refusals: mode catalog discovery
`cf35c2b8-48b7-4bbe-ab7c-f52e90406d6f`; default changelog
`a22c6230-ca13-4656-ae36-d84f6ecb8631`. Failing regressions reproduced both
and the limits guide's omitted live tools. Contract 3.1.0 restores advertised
mode discovery, adds bounded lossless changelog pages and corrects affected
docs/What's New. The exact-deck drill regression now pins player identities
to the matching deck hash (#37). Larger directions remain the dated decision
in `docs/NOTES.md` (#35) and an undefined playstyle score (#36).

## Daily evidence

Migrate `audit_census({days:1})`, before our acceptance reads: 777 calls,
nine tool errors (rankings_players not_found 3, war_current not_recorded 3,
war_history invalid_tag 2, live_fetch live_pending 1), one oversized changelog
result. REST: 41 calls, no errors. Analytical tails persist without failure:
card meta max 19.79s/10 calls; deck meta max 20.62s/8 calls; participation
max 17.63s/17 calls. Sixteen tools uncalled over this day; no deletion inferred.

The owner's read-only activity preview: 11 subjects, eight entries, three
quiet, 38 items, 1.856s. Actual agent timeline dry run:
`9c84c15e-3314-4a36-a59e-a5feffec9924`, unchanged null read pointer,
one clan subject pending and zero feedback responses pending. Full same-window
read `2c8f2aa6-b001-4a00-b434-1ab74f89f7bc`: 462 battles, 113 sessions,
33/47 active members; training, no decks and no finish instant. Independent
war read `262d8834-03b7-42ef-9207-b3b5175b6aa0` agrees on those war fields.
Standings `b4bb0681-6ef7-4f21-bd82-519bf0e98b13` has 410 played-window
battles over 29 current members; timeline uses learned time and an earlier
played-time guard, so these are different populations, not competing totals.

All three naturally running preview principals have 3.0.0 boot receipts.
Since the previous completion: 139/127/84 log lines, zero errors and one
expected version-change warning. No bot restart, routine, message, pointer or
local cursor mutation was triggered here. #33 quality acceptance remains
`insufficient_sample` without a comparable natural all-evidence-failed turn.

Public status is green: DLQ zero, 911 battles/hour, 105 gaps/7,037 audited
polls (1.49%); capture cadence remains Record/Run's existing watch. Stack
UPDATE_COMPLETE at 00:12:25Z. Jamie identity, live read capability and required
Lambda/S3/CloudFormation/CloudFront/IAM actions were checked before runtime
edits, without a test mutation. Deployment uses the existing smoke-gated
script and preserved stack parameters; content-addressed previous artifacts
remain the rollback source. No infrastructure or schema change in this run.

## Completion receipt

Contract 3.1.0 shipped on main: 8c3cfd4 (discovery/history/docs), bfbee73
(reply timestamp precision), d19284c (catalog source freshness). All three
canonical deployments completed with smoke PASS; migrations 89 applied, zero
new migrations. Final full `npm run verify`: 730 tests passed, zero failures,
with format, lint, knip and type checks green.

Live agent handshake: 3.1.0+tools.31c9c414d029, 53 public / 50 agent tools;
the retired elixir_events is absent. Catalog discovery returns 30 boards;
final freshness read 5c318e98-918e-4727-a1a4-b3482d75379b reports the GLOBAL
leaderboards admission at 09:27:39Z. Numeric Merge board
d1abafe7-44b3-412c-80ca-3252d201b08a succeeds with 1,000 places, explicitly
truncated. Unknown-mode refusal 106e51cd-bcf3-4270-868f-301e2ad31fdf gives
the executable discovery hint. Four changelog pages retain all 65 canonical
releases (f8f9125f, a596d27a, 8a087479, 1bc35d05 request prefixes).
Public and MCP limits, protocol, choosing-a-tool, timeline, privacy and recording
pages passed source-specific checks without unrendered template tokens.

Feedback writes were serialized by the loop lease using committed tooling,
re-read immediately before each write and verified with a full-precision
read-back. #35 and #36 are seen with specific existing workflows and pending
product boundaries; #37 and #38 are done, naming 3.1.0 / 8c3cfd4. Replies landed
12:01:59Z–12:02:02Z, all under one day. Final backlog zero, oldest unanswered
age null, zero missed targets. No requester's read pointer was consumed.

CI's pre-existing console failure was also reproduced: the fixture still sent
events_unseen and /api/me/events, and expected a Notifications heading after
3.0.0 retired them. Fixtures now provide timeline_pending and /api/me/timeline;
the journey checks the Timeline heading, named session and unread row.
Playwright: nine journeys passed across wide/narrow, including navigation,
rail disclosure, keyboard dismissal and accessibility checks. Browser plugin
not available; used the repository's Playwright workflow. Additional rendered
checks at 1280×900 and 420×860 verified page identity, meaningful content,
no framework/error boundary overlay and zero browser console/page errors.
Screenshots inspected under the private receipt prefix; the narrow table keeps
its existing horizontal scroll behavior. No frontend runtime change was needed.

Private receipts remain under `/tmp/elixir-loop-20260914-*`; no captured bodies
or principal identifiers were committed.

W37 synthesis/completion receipt already exists and was read. Next deep pass:
September 18 evening America/Chicago. Next daily eligible check: September 14
18:45 CDT. No W37 synthesis or delivered prior reply was repeated.
