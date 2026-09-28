# Processing the 2026-09-27 review: four lanes

This brief takes
[`2026-09-27-ARCHITECTURE-DURABILITY-FEATURES.md`](2026-09-27-ARCHITECTURE-DURABILITY-FEATURES.md)
(the review) into production.

**Approach (Jamie, 2026-09-27).** The review's 91 surviving findings are
sorted by *who has to decide*, not by subsystem, into four lanes:

- **Lane A** shipped on 2026-09-27 and 2026-09-28, as issues #62-#73
  plus the older bugs #44 and #43, all labelled `review-2026-09-27`.
  Each issue got a fresh session: either one interactive session per
  issue, or one unattended orchestrator that hands each issue to a new
  subagent. Each issue closed only once its fix was deployed and read
  back.
- **Lane B** was decided on 2026-09-28. Its three yeses and two small
  fixes joined the same queue (rows 15-19 below). The rest of lane B
  moved to lane D, each item with its trigger.
- **Lanes C and D** stay in this file, not filed as issues, so nothing
  sits open. When no labelled issue remains open, Jamie and Claude take
  up lane C.

**Set aside (Jamie):** database restore. That removes the database half
of the review's §2.1, all of §2.2 and all of §2.3. The DECISIONS line is
under "Declined". Open issue #48 (an RDS recovery rehearsal) closes as
not planned under it.

**Already done:** the email-relay `err.message` item from §8.1 (PR #56,
`76f68c6`).

| Lane | What it holds | Findings | Jamie's part |
|---|---|---|---|
| A. Fix and harden | Security, and code that breaks a ratified rule or a published promise | 41, in 12 issues | Reviews the outcomes |
| B. Features | New capability | Decided 2026-09-28: 3 yes, 2 fixes, 3 parked | Answered |
| C. Policy | Privacy and data subjects, growth priorities, collector-fleet trust | 11, in 3 topics | A review; nothing is built first |
| D. Parked | Efficiency, refactors, anything that should be measured first | 30 | None until its trigger |

---

## The queue

Rows 1-14 (lane A) are closed; #62 was done interactively. Rows 15-19
are the fixes and features from the lane B revisit. The queue runs in
table order.

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
| 15 | #108 | A13: `battles_compare` carries the completeness note | 7.3 |
| 16 | #109 | A14: Event classification: clanmate battles are casual; game-mode rows never pool events | 7.1 |
| 17 | #46 | B1: Historical clan roles on `clans_participation` (the plan is in the issue's 2026-09-28 comment) | — |
| 18 | #110 | B2: Record Evolution and Hero unlocks as moments | 7.2 |
| 19 | #111 | B3: Stable timeline item ids, so agents tell a story once and update it | 7.4 |

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
review-2026-09-27 in jthingelstad/elixir-mcp, in the order of the queue
table in docs/reviews/2026-09-27-EXECUTION-BRIEF.md. Follow the worker
rules there, interactively. One issue this session.
```

#### Prompt B: the loop (the orchestrator follows this)

The orchestrator never works an issue itself. Its context holds only the
queue state and each subagent's report.

1. **Pick.**
   - Take the next open issue labelled `review-2026-09-27` and not
     labelled `needs-jamie`, in the order of the queue table.
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
   done apart from those, and that it is time for the lane C review.

---

## Lane B: features (decided 2026-09-28)

**Yes:** these joined the queue.

- **#46: historical clan roles on `clans_participation`.** Elixir Clan's
  promotion replay rests on current roles at past war finishes, and on
  members who left not appearing at all. Both reproduce live.
- **#110: the Evolution/Hero unlock moment.** This is the one part of
  card history that matters for Jamie's own main account. It records
  going forward only.
- **#111: stable timeline item ids, built for storytelling.** Jamie:
  "meaningful to the discord bots as well as Claude using the MCP … how
  you tell stories as an agent using the MCP is weak now." The id is
  the story, and a revision marks growth, so an agent tells a story once
  and updates it.

**Fixes found by the revisit:**

- **#108:** `battles_compare` never attached the completeness note.
- **#109:** event classification. Jamie's ruling settles the conflict
  between DECISIONS 18 and 75: a clanmate battle is casual even when
  tagged, and a tagged `unknown` battle such as Royale Shuffle is event
  content. Game-mode rows also stop pooling several events into one row.

**Parked:** these moved to lane D, each with its trigger.

**Also raised: agent storytelling.** Jamie finds how agents tell stories
through Elixir weak. #111 is one piece. A focused look is a candidate
after lane C, for example a Gym journey that asks an agent to tell a
player's or a clan's week and judges the result.

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

- **Parked from lane B (2026-09-28):**
  - **Gaps as a precise control (§7.3).** Streaks stop at a located
    capture hole. Trigger: a consumer reports a streak or session
    standout that spanned a hole, or capture gaps climb as the budget
    binds.
  - **The event as a population (§7.1).** `group_by: "event"` and an
    `event_tag` filter. Trigger: a feedback item or Gym case asks for
    per-event results. `args_census` records argument keys, not values,
    so it cannot measure this on its own.
  - **Card history `changes[]` (§7.2).** What a player upgraded, and
    when. Trigger: a player or agent asks what they upgraded.
  - **A supported-clients matrix (§6.2).** Trigger: lane C defines open
    beta, or `{audit_census}` shows clients other than Claude Code. Of
    its two halves, the real-client Gym journey is the stronger one.

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
