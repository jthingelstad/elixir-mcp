# Processing the 2026-09-27 review: four lanes

This brief takes
[`2026-09-27-ARCHITECTURE-DURABILITY-FEATURES.md`](2026-09-27-ARCHITECTURE-DURABILITY-FEATURES.md)
(the review) into production.

**Approach (Jamie, 2026-09-27).** The review's 91 surviving findings are
sorted by *who has to decide*, not by subsystem, into four lanes:

- **Lane A** is being worked now. Its findings are GitHub issues labelled
  `review-2026-09-27`. Each issue gets a fresh session: either one
  interactive session per issue, or one unattended orchestrator that
  hands each issue to a new subagent. Each issue closes only once its
  fix is deployed and read back.
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
| 1 | #62 | A1: Door hardening (interactive only: private notes, Jamie's approvals, Clan and Drop) | 6.5 |
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

There are two ways to run the queue. The worker rules are the same in
both.

- **Prompt A: interactive.** One issue per session, with Jamie at the
  keyboard.
- **Prompt B: unattended.** One session is the orchestrator. It hands
  each issue to a fresh subagent and loops until the queue is done. When
  nobody is at the keyboard, "ask Jamie" becomes the `needs-jamie` label.

**#62 (A1, door hardening) is interactive only.** It needs Jamie's
private notes, two approvals and changes in Elixir Clan and Elixir Drop,
so the unattended loop skips it.

#### Worker rules (one issue)

1. **Read, in order:**
   - the issue, with `gh issue view <N> --comments`;
   - the review sections it names;
   - `docs/DECISIONS.md`;
   - the working style in `AGENTS.md`;
   - the SKILL.md of every skill the issue names, under
     `.claude/skills/`. Always read and follow
     `.claude/skills/ship/SKILL.md` for shipping.
2. **Sync, then claim.**
   - On a clean `main`, fast-forward to `origin/main`.
   - Run `AGENT-TEAM/scripts/preflight.sh`.
   - Claim the lease: `node AGENT-TEAM/scripts/objective-lease.mjs
     claim session`, and keep the returned lease id. If the claim is
     refused, stop and report `lease busy`.
   - Branch as `review/<N>-<slug>`.
3. **Re-verify.** The issues cite `c8ae040`. Check every `path:line`
   against current `main`. If a part no longer holds, skip it and say
   why.
4. **Decisions.** Some parts need a product, policy or cost decision
   that neither the issue nor the run's pre-authorizations settle.
   - **Interactive:** ask Jamie before writing code.
   - **Unattended:** do not guess, and do not widen scope.
     - Finish the parts that stand alone without the decision.
     - Comment the exact question on the issue. The repo is public, so
       the comment holds no secrets and no private data.
     - Add the `needs-jamie` label.
     - Release the lease and stop.
5. **Build.** Where the issue names a failure, write the test that shows
   it first. Then run `npm run verify`.
6. **Ship** per the ship skill:
   - the PR body says `Refs #<N>`, never `Fixes #<N>`, so the issue does
     not close on merge;
   - `gh pr merge --auto --rebase --delete-branch`, then wait for the
     merge on a green `validate`;
   - deploy from an up-to-date `main` at the issue's acceptance scope;
   - triage any acceptance failure;
   - do the read-back the issue asks for.

   A large issue may take two PRs.
7. **Failure.** If CI or the deploy fails and the fix is outside the
   issue's scope:
   - leave the PR open;
   - comment on the issue with what failed;
   - add `needs-jamie`;
   - release the lease;
   - report whether production is healthy (`/api/public/status` shows
     `"ok":true`).
8. **Close.**
   - Comment on the issue with the PRs, the deploy and the read-back.
   - List any check that needs a later natural event (a Monday run, a
     day of lifecycle, a week of data). The lane B revisit confirms
     those.
   - Close the issue with `gh issue close <N> --reason completed`.
   - Confirm the tree is clean, then release the lease.
9. **Report,** in at most 10 lines:
   - the issue;
   - the outcome: closed, needs-jamie, failed, or lease busy;
   - the PRs and the deploy;
   - pending checks;
   - whether production is healthy.

**Always:**

- Never commit secrets or private data.
- Never push to `main` directly.
- Never skip or disable a test to get to green.

#### Prompt A: one issue, interactive

```
Work the next issue in the review queue: the open GitHub issues labelled
review-2026-09-27 in jthingelstad/elixir-mcp, in the order of the lane A
table in docs/reviews/2026-09-27-EXECUTION-BRIEF.md. Follow the worker
rules there, interactively. One issue this session.
```

#### Prompt B: the loop (the orchestrator follows this)

The orchestrator never works an issue itself. Its context holds only the
queue state and each subagent's report.

1. **Pick.**
   - Take the next open issue labelled `review-2026-09-27` and not
     labelled `needs-jamie`, in the order of the lane A table.
   - Skip #62.
   - If none is left, go to step 6.
2. **Check health.** `curl -s
   https://elixir.poapkings.com/api/public/status` must show
   `"ok":true`. If it does not, stop the loop and report.
3. **Delegate.** Spawn one general-purpose subagent, in the foreground,
   with this prompt:

   ```
   Work GitHub issue #<N> in jthingelstad/elixir-mcp end to end,
   unattended: nobody can answer questions during this run. Follow the
   worker rules in "Working the queue" in
   docs/reviews/2026-09-27-EXECUTION-BRIEF.md, in unattended mode.
   Pre-authorized for this run: <the run's pre-authorizations, or
   "none">. Return only the rule 9 report.
   ```

4. **Read the report**, and confirm the issue's state with `gh issue view
   <N>`.
   - **Closed:** go to the next issue.
   - **needs-jamie:** note the question, then go to the next issue.
   - **Lease busy:** wait about 10 minutes, then retry the same issue,
     up to six times. After that, stop and report.
   - **Failed:** stop the loop if production is unhealthy, if a deploy
     failed and was not recovered, or if `main`'s `validate` is red.
     Never start another issue on top of a broken deploy.
5. Go back to step 1.
6. **Finish.** Report:
   - a table of every issue with its outcome, PRs and pending checks;
   - the needs-jamie questions.

   If only #62 and needs-jamie issues remain open, say that lane A is
   done apart from those, and that it is time for the lane B revisit.

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
