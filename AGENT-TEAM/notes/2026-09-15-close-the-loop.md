# Close the Loop — 2026-09-15 evening

Reviewed source `7bb582d`, decisions and contract changes through 3.7.0, the
current required product pages, and the preview's operating contract at 18:47
CDT. Preflight found a clean synchronized unleased checkout, no queued handoff
notes and healthy public capture (287-second fetch/admission age, zero DLQ,
1,034 battles in the last hour, 103 gaps among 7,082 capture-audit polls).
Jamie identity, read-only migrate operations and the stack were available. IAM
simulation allowed every deployment action needed by the documented path before
runtime editing began.

## Queue, audit and push lane

- The opening and final `{feedback_pending:true}` reads both returned zero
  items: no oldest age, no one-day breach and no response to send or repeat.
  The next eligible check is 2026-09-16 06:45 CDT.
- `{audit_census:{days:1}}` returned 1,177 calls, 49 errors and two truncated
  results. The 19 `bad_request` calls on `battles_cards`, `battles_decks` and
  `battles_performance` all supplied `days`; contract 3.7.0 had already repaired
  that schema drift. The 19 meta-card/deck query timeout or internal results
  belonged to the earlier deployment/acceptance window. Six `war_history`
  `invalid_tag` refusals are the understood elixir-bot fixture traffic. There
  was no live-fetch traffic and no new entitlement pattern.
- Both truncations were natural `elixir_my_feedback` calls, largest 99,805
  characters. The handler acknowledged every account response before the
  protocol replaced the oversized body with `result_too_large`, so a caller
  could lose its pending signal without seeing the reply. This was the one new
  loop-breaking defect and became the run's target.
- The owner's read-only 24-hour `elixir_timeline` preview returned 11 subjects,
  60 items, eight entries and three quiet rows without moving its pointer. A
  direct clan-agent timeline read returned 42 items for one clan, with
  `timeline_pending:1`; the same window's standings and current-war reads agreed
  on the training-day state. The 385 timeline battles versus 415 standings
  battles are the documented subject/time-population difference, not a data
  contradiction.
- The public required pages, generated tool manifest and machine-readable
  surfaces all served real documents. The reading map alone still named deleted
  `events.md`; it now names the ratified `timeline.md`, and decision case
  `reading-map-stale` protects the current changelog/source over saved summaries.
  Comparable scheduled evidence does not exist yet, so instruction-quality
  acceptance is `insufficient_sample` until the next run resolves the whole map.

## Shipped correction and acceptance

Under loop lease `edfae281-df64-4e15-bcff-f8daf9b61b7c`, the focused scratch
regression first reproduced an over-cap feedback page, then passed after the
minimal correction. `elixir_my_feedback` now returns size-bounded pages with
`total` and `next_offset`, accepts `offset`, and marks only the replies present
in the delivered page as seen. Its post-call pending hint remains raised for
undelivered responses. Public protocol, architecture, What's New and changelog
ship with additive contract 3.8.0.

`npm run verify` passed formatting, lint, Knip, type checks, both builds and all
workspace/owner tests. Commit `65e072f` is pushed on main. The canonical deploy
ran 102 existing migrations and zero new migrations, reached
`UPDATE_COMPLETE`, published the merged site and passed every smoke check.
Read-only live acceptance at 19:04 CDT confirmed agent principal identity,
`3.8.0+tools.f9ec635e7814`, the four feedback arguments including `offset`, and
a successful 6,590-character ledger response with four of four items,
`next_offset:null` and no pending reply (request
`bcbc36a4-c108-4f58-b58a-de311407f77e`). `/tools.json` publishes contract 3.8.0,
53 tools and the same pagination contract; protocol, updates, changelog and
status returned 200. Final health was green with 193-second fetch/admission age,
zero DLQ, 852 battles in the last hour and 105 gaps among 7,065 capture polls.

The preview consumer also had to follow the additive pages. In its own clean
checkout, regression coverage now proves the deterministic reader consumes
every `next_offset` page while omitting offset on the compatibility call. Its
full `npm run verify` passed 163 tests; `e60bccf` is pushed. POAP KINGS, Elixir
Kings and Ship It restarted one at a time and each booted
`build=0.3.0+e60bccf`, connected to contract 3.8.0, validated its channel and
started its scheduler. No routine or question was forced for acceptance; the
next natural feedback read remains the runtime receipt.

## Closed findings and watches

The POAP DM `container_id required` line was confined to the short-lived
`web_fetch` experiment: `f8161d2`, its carry-forward fix `d200ce5`, and both
reverts `397af87`/`26f80ca` within the same minute. Current source exposes
neither feature, so this is closed as non-recurring rather than reproduced.

Keep a preview-mechanics watch on `post_without_destination`: capability
spotlight produced one naturally on Ship It at 2026-09-14T22:02Z and one on
Elixir Kings at 2026-09-15T22:00Z. Do not manufacture another run; assess the
next natural occurrence. The 23 tools uncalled in the one-day census are not a
standalone discoverability verdict while the preview's scheduled workload is
deliberately narrow.

Week 37's Friday synthesis remains complete and must not be repeated. The next
deep pass is due 2026-09-18 evening CDT.
