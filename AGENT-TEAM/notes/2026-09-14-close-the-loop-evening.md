# Close the Loop — September 14 evening

Reviewed `e814910`, deployed contract 3.1.0 and decisions since the morning
run. Initial preflight was eligible: clean synchronized main, no lease, stack
and public documents available, DLQ zero, 1,042 battles/hour and 87 capture
gaps among 6,914 audited polls. Claimed the `loop` lease immediately before
the first edit; all feedback writes were serialized under that same lease.

## Measured gap and source work

The 23:58Z feedback read found eight unanswered items, #39–#46, oldest 6h58m
and none beyond the one-day response target. #39 and #40 were discovery gaps:
an unrecorded rival roster refusal did not give the exact live fallback, and
the existing one-call short-window standings path was not sufficiently clear.
#41–#46 were one reliability incident, not six parameter defects. CloudWatch
REPORT lines showed 18 MCP invocations ending at exactly 25 seconds during the
preview agents' 21:58–22:08Z burst. Database CPU rose transiently from its
4–7% baseline to 52.4%, then returned to 5.6%; memory was not constrained.

Contract 3.2.0 (`b0922b5`) gives only the three affected read-only aggregates
an at-most-18-second cumulative PostgreSQL query budget, shortened by the
Lambda time remaining. PostgreSQL cancels the active statement; the invoker
restores the session setting and returns `query_timeout` with a request id and
executable retry before normal audit/capture. Account mutations remain outside
this boundary. No Lambda ceiling, database capacity, capture cadence or spend
changed. The same release reuses the meta population scan for the corpus prior,
adds the exact roster live retry, and advertises the existing standings window.

Initial live acceptance showed the error boundary working but did not close
the deck reports: the two full-corpus shapes returned `query_timeout` in
18.4–18.5 seconds. The measured source seam was `array_agg` retaining every
full JSON deck before applying the result limit. Contract 3.2.1 (`6a44a08`)
instead retains the latest qualifying participant key per aggregate and
hydrates only the returned examples through the participant primary key.
Scope, latest qualifying example, counts and shrinkage remain pinned. A
regression specifically prevents a newer out-of-segment example from leaking
into a scoped result.

## Verification and production acceptance

The 3.2.0 full gate passed 924 tests; the final 3.2.1 gate passed 925 tests,
with formatting, lint, dead-code/dependency checks and types green. Both
canonical deployments applied zero new migrations and passed their external
smoke suites. GitHub validate runs 34910862655 and 34911161886 completed
successfully. Public `tools.json` reports contract 3.2.1 and all shipped
protocol, methodology and tool-choice pages return real documents without
template residue.

Live 3.2.1 agent handshake: `3.2.1+tools.231a797bc56d`. The exact feedback
shapes now return:

- full corpus, `min_battles: 20`, five rows: 11.6s, request
  `f9447f6a-dfc2-4827-80fc-68c1ab364549`;
- full corpus, `min_battles: 30`, five rows: 9.9s, request
  `92f9c0d8-ff1d-4381-861a-a0f237ea0e29`;
- clan segment, battle sort, five rows: 9.8s, request
  `ea0c1baf-2e29-428c-a577-f1e40e7354eb`.

Both corpus reads cover 297,878 decided battles; the clan read covers 12,246.
All fifteen returned rows have hydrated examples and no internal exemplar key.
Earlier live acceptance also measured corpus cards at 12.1–12.3s, clan cards
at 9.5s, standings at 1.2s and the one-day standings scan at 0.24s. The two
intentional 3.2.0 timeout-boundary probes are now present in audit as
`query_timeout`; they are acceptance evidence, not new natural failures.

Feedback #39–#46 was re-read immediately before each conditional write and
read back afterward at full timestamp precision. All are `done`, naming
3.2.0 or 3.2.1 and the relevant tools. Replies landed from 00:03:40Z through
00:03:48Z. Final backlog: zero unanswered, null oldest age, zero overdue. No
requester's feedback or timeline pointer was consumed.

## Daily evidence and watches

The final one-day audit contains 1,064 MCP/REST calls. Its 20 errors are
expected refusals plus the two deliberate timeout probes: roster/war data not
recorded, ranking not found, live pending, one no-subject call and the probes.
REST has 20 calls and zero errors. Twenty-three tools are uncalled in this
window; that remains a watch, not evidence for deletion.

The owner activity preview covered 11 subjects, nine entries and two quiet
subjects in 1.586s. The live timeline dry run preserved its null read pointer,
returned 34 items and one clan entry, and agreed with an independent war read;
no player message, feedback cursor, session cursor or watch was created. All
three preview principals had 3.1.0 boot receipts before this deployment; no
restart was forced merely to make them reconnect. One naturally comparable
all-meta-failed turn produced a truthful skip rather than a claim, which is
positive evidence for #33 but still too little to declare a general quality
rate. No bot routine or Discord post was forced.

Existing product decisions remain open: #34's comparison context and #35's
bulk trophy/streak shape still require Jamie; #36 still has no defined
playstyle score. Capture health and the 139 stale regional boards stay with
their existing owners; the new natural non-200 receipts explain most, not all,
of that board population. Do not manufacture traffic for either watch.

The W37 completion receipt already exists and was not repeated. Next daily
eligible check: September 15 at 06:45 America/Chicago. Next deep pass:
September 18 evening America/Chicago. Private command logs remain under
`/tmp/elixir-loop-evening-20260914-*`; no captured bodies, member tags or
principal identifiers were committed.
