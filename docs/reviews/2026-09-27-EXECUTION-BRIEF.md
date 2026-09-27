# Processing the 2026-09-27 review: four lanes

This brief takes
[`2026-09-27-ARCHITECTURE-DURABILITY-FEATURES.md`](2026-09-27-ARCHITECTURE-DURABILITY-FEATURES.md)
(the review) into production.

**Approach (Jamie, 2026-09-27).** The review's 91 surviving findings are
sorted by *who has to decide*, not by subsystem, into four lanes:

- **Lane A** is being worked now. Its findings are GitHub issues labelled
  `review-2026-09-27`, one issue per local Claude Code session. Each
  issue closes only once its fix is deployed and read back.
- **Lanes B, C and D** are held in this file, not filed as issues, so
  nothing sits open. When no labelled issue remains open, Jamie and
  Claude revisit them, starting with lane B.

**Set aside (Jamie):** database restore. That removes the database half
of the review's §2.1, all of §2.2 and all of §2.3. The DECISIONS line is
under "Declined". Open issue #48 (an RDS recovery rehearsal) closes as
not planned under it.

**Already done:** the email-relay `err.message` item from §8.1 (PR #56,
`76f68c6`).

| Lane | What it holds | Findings | Jamie's part |
|---|---|---|---|
| A. Fix and harden | Security, and code that breaks a ratified rule or a published promise | 41, in 12 issues | Reviews the outcomes |
| B. Features | New capability | 5, plus issue #46 | Yes, no or later on each |
| C. Policy | Privacy and data subjects, growth priorities, collector-fleet trust | 11, in 3 topics | A review; nothing is built first |
| D. Parked | Efficiency, refactors, anything that should be measured first | 30 | None until its trigger |

---

## Lane A: fix and harden (in progress)

Worked in this order:

| Order | Issue | Title | Review § |
|---|---|---|---|
| 1 | #62 | A1: Door hardening (the details are private; ask Jamie) | 6.5 |
| 2 | #63 | A2: Bound and name every database backend | 3.1-3.3 |
| 3 | #64 | A3: Enforce the one global budget in code | 4.1, 4.2 |
| 4 | #65 | A4: Deliver the whole server brief; spec-compliant error results | 6.1, 6.2 |
| 5 | #66 | A5: Make captures and the public repo match the privacy page | 6.4, 6.8 |
| 6 | #67 | A6: Fix product-mail send bugs | 6.7 |
| 7 | #68 | A7: Harden the written-issue pipeline (after A6) | 6.7 |
| 8 | #69 | A8: Scheduler correctness: retries, board metric, session ceiling | 2.6, 4.5 |
| 9 | #70 | A9: Ingest and collector-door hardening | 2.5, 2.7, 6.6 |
| 10 | #71 | A10: Observability and hygiene (confirm about $0.50/mo of alarms) | 5.2, 5.3, 8.5, 8.6 |
| 11 | #72 | A11: Console bugs: record links, failed writes, Explore | 7.5 |
| 12 | #73 | A12: Edge caching, site publishing and feed fixes | 5.4, 7.6, 7.7, 8.4 |
| 13 | #44 | Keep non-catalog support stubs out of `cards_catalog` (older bug) | — |
| 14 | #43 | Restore console CI coverage for the timeline contract (older; may already be fixed) | — |

### Working the queue

Paste the same prompt into a fresh Claude Code session for each issue:

```
Work the next issue in the review queue: the open GitHub issues labelled
review-2026-09-27 in jthingelstad/elixir-mcp. Follow "Working the queue"
in docs/reviews/2026-09-27-EXECUTION-BRIEF.md. One issue this session.
```

The rules that prompt points to:

1. **First session only.** If the review is not yet on `main`, land the
   branch `claude/data-product-review-61awdw` through a PR (`gh pr
   create --fill`, `gh pr merge --auto --rebase --delete-branch`). It is
   docs only, so there is no deploy. Then close #48 as not planned,
   citing the 2026-09-27 DECISIONS line that declines database restore
   work.
2. **Pick** the next open labelled issue in the order in the table
   above. Before changing anything, tell Jamie which issue it is and give
   a plan in about five lines.
3. **A1 (#62) is private.** Ask Jamie for the private notes before
   starting. Never commit, log or quote them in a commit, PR, NOTES entry
   or issue comment until the fixes are deployed. PR titles and
   descriptions say "door hardening (review §6.5)" and nothing more.
4. **Preflight.** Claim the checkout lease (`session`), run the
   preflight, and branch from an up-to-date `main`.
5. **Read, in order:** the issue, the review sections it names,
   `docs/DECISIONS.md`, and the repo skills it names. Re-verify every
   `path:line` against current `main`; the issues cite `c8ae040`. If a
   part no longer holds, skip it and say why in the closing comment.
6. **Decisions come before code.** If a part needs a product, policy or
   cost decision the issue does not already name, ask Jamie before
   writing any code. Do not widen scope. Anything new that turns up goes
   into the closing comment for the lane B/C/D revisit, not into a new
   issue.
7. **Build.** Where the issue names a failure, write the test that shows
   it first. Then run `npm run verify`.
8. **Ship with `/ship`** at the issue's acceptance scope. The PR
   references the issue with `Refs #N`, not `Fixes #N`, so the issue does
   not close on merge. A large issue may take two PRs.
9. **Close.** After the deploy and the read-back the issue asks for,
   comment on the issue with the PRs, the deploy and the read-back, then
   close it. If a done-when check needs a later natural event (a Monday
   run, a day of lifecycle, a week of data), close the issue anyway once
   it is deployed, and list the pending check in the closing comment. The
   revisit confirms those.
10. **Stop.** Release the lease and report: the issue closed, what
    shipped, and what was deferred. When no labelled issue is open, say
    it is time for the lane B revisit.

---

## Lane B: features (held for the revisit)

Each one is a yes, a no or a later. A yes goes through `/tool-change`.

- **Gaps as a precise control (§7.3).** Streaks and `last_n` samples stop
  at a capture gap the record knows about, and `elixir_coverage` shows
  the intervals.
- **The event as a population (§7.1).** `group_by: "event"` on
  `battles_performance`, then an `event_tag` filter.
- **Card history (§7.2).** A `card_form_unlocked` moment, and the
  upgrades a player made, served on `players_collection`.
- **Stable timeline item ids (§7.4).** A per-account Atom/JSON Feed of
  the timeline is held until someone asks for one.
- **A supported-clients matrix for open beta (§6.2).** Claude.ai, Desktop,
  Code and ChatGPT, measured, plus one real-client Gym journey per
  release.
- **#46: historical clan roles on `clans_participation`.** Filed earlier
  by the agent team, for Elixir Clan's replay.

## Lane C: policy (held; Jamie's review first)

Nothing in this lane is built until Jamie has decided. Each topic is one
conversation that ends in DECISIONS lines, and those become lane A or B
work.

- **Privacy and data subjects (§6.3, §6.8).** Start by Jamie reading
  `privacy.md` and `terms.md`: the review found public commitments there
  that he has not reviewed.
  - Does open beta mean general signup?
  - Account erasure and export.
  - A contact route that needs no account.
  - Retention windows: access requests, sent mail, aways and clan
    messages.
  - Children.
  - Proposed rule: pages that make policy promises (privacy, terms,
    limits) change only with Jamie's word.
- **Growth priorities (§4.2-4.4, §5.3).**
  - The saturation ladder, meaning the order in which work degrades when
    the budget binds, and then the planner's class order.
  - Keep the Boards' "~400 is a defect" line against the sticky rule's
    608.
  - The pre-reset watcher.
  - The `MaxAllocatedStorage` ceiling. The first autoscale is around
    10-13 to 10-18.
  - A written trigger for db.t4g.medium.
- **Collector-fleet trust (§2.4).**
  - Where the five collectors are, and a second site.
  - A written trust decision for an outside operator.
  - The shadow verification lane before any stranger's collector goes
    active.
  - Off-account replication of the `payloads/` archive. This is separate
    from database restore; the risk it covers is account-level.

## Lane D: parked (not worked until the trigger)

- **Measure with `pg_stat_statements` first** (it arrives in A10):
  - the invoker's fixed cost (§5.1);
  - a result cache;
  - `card_keys` on the population table;
  - per-container connection reuse;
  - the MCP Lambda's memory;
  - the nightly rebuild and activity-job tidies (§5.5-5.7).
- **Wait for scale:**
  - the mail compose fan-out and per-run memo, once a logged weekly run
    passes about 450 s (§6.7);
  - day-major archive bundles, when the first corpus question arrives
    (§7.7);
  - a split recording door, if console or `/api/v1` growth warrants it
    (§6.6).
- **Engineering system, when the queue is clear:**
  - the ops registry with enforced modes (§3.3);
  - run receipts (§8.2);
  - scheduled CI and `pinClock` (§8.3);
  - a batch marker for deploys;
  - decision-citation tests;
  - API Gateway managed overrides;
  - a decisive smoke (§8.5);
  - e2e failure fixtures and router adoption (§8.4);
  - honest 404s (§7.5);
  - the `llms-full.txt` trim (§7.6);
  - the console bundle diet (§5.4).
- **Low-value hardening, only if an incident shows it matters:**
  - roster ordering (§2.7);
  - the attested-fact extras (§6.8): an app's clan grant, member
    anchoring, seat freshness;
  - per-actor worktrees and decision ids (§8.3).

---

_This material is unofficial and is not endorsed by Supercell. For more
information see Supercell's Fan Content Policy:
www.supercell.com/fan-content-policy._
