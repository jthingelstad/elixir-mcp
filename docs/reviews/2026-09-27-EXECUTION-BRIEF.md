# Execution brief: the 2026-09-27 review, in chunks

This brief takes
[`2026-09-27-ARCHITECTURE-DURABILITY-FEATURES.md`](2026-09-27-ARCHITECTURE-DURABILITY-FEATURES.md)
(the review) into production one chunk at a time. Each chunk is one
local Claude Code session. Jamie starts each session and gates the
next. The review holds the findings and their evidence; this brief
holds the order, the scope, the decisions each chunk needs, and the
ship scope. The tracker at the end records what has shipped.

**Set aside (Jamie, 2026-09-27):** "The one thing I'm not worried about
is restoring the database … I'm very comfortable with its resilience."
That removes these parts of the review:

- the database half of §2.1 (an off-account snapshot copy);
- all of §2.2 (restore runbook, rehearsal, `deploy.mjs --stack-only`,
  the 7 → 35 day retention increase, Multi-AZ);
- all of §2.3 (the replay-parity proof and the receipts export).

The DECISIONS line is under "Declined". Chunk C3 reconciles the Run
objective's quarterly restore rehearsal with it.

**Already done:** Guard the Door fixed the email-relay `err.message`
item (review §8.1) the same morning: PR #56, `76f68c6`.

---

## Running a chunk

The prompt for a session:

```
Execute chunk C<N> of docs/reviews/2026-09-27-EXECUTION-BRIEF.md.
Decide-before answers: <the answers, or "none needed">.
```

Start a fresh session for each chunk. C1 and C2 also take Jamie's
private notes, pasted below that prompt (see rule 9).

1. **Preflight.** Claim the checkout lease (`session`) and run the
   preflight. Start from an up-to-date `main`, on a branch named
   `review/c<N>-<slug>`.
2. **Read in this order:** the chunk; the review sections it names;
   `docs/DECISIONS.md`; the repo skill the chunk names (`tool-change`,
   `migration`, `ops`, `consistency`, `ship`).
3. **Decisions come before code.** If a decide-before item has no
   answer in the prompt, ask Jamie before writing any code. Record the
   answer in NOTES. If it is a decision, add its DECISIONS line in the
   chunk's PR.
4. **Re-verify first.** The review cites `c8ae040`, and line numbers
   drift. Confirm each citation against current `main` before changing
   anything. If a finding no longer holds, skip it and say so in the
   NOTES entry.
5. **Write the test first.** Where the review names a failure, write the
   test that shows it, then fix it. Then run `npm run verify`.
6. **Ship with `/ship`** at the chunk's acceptance scope. One PR per
   chunk. If a chunk runs long, split it at a natural seam into two PRs
   and say so in the tracker.
7. **In the chunk's PR:** tick its tracker line with the PR number; add
   the NOTES entry; and do the site docs, What's new and contract
   bookkeeping the house rules require.
8. **Leftovers** go to the owed-work register once C3 has built it, and
   to NOTES before that.
9. **C1 and C2 are private.** Their mechanics exist only in Jamie's
   notes. Never commit, log or quote them. PR titles and descriptions
   say "door hardening (review §6.5)". The details may go into NOTES
   once the fix is deployed.

**Sizes.** S is a short session, M a full session, and L may take two
PRs.

**Acceptance scope** follows the ship skill:

- a family name when a tool in that family changed;
- `--acceptance` when shared code (invoker, protocol, registry, ingest)
  changed;
- none when nothing a tool serves changed, with NOTES saying why.

---

## The sequence

| Wave | Chunk | Name | Review § | Size | Waits on Jamie |
|---|---|---|---|---|---|
| 0 | C0 | Land the review | — | S | — |
| 1: close what is exposed | C1 | Door hardening I (private) | 6.5 | M | first-party wording; the revoke list |
| | C2 | Door hardening II (private) | 6.5 | M | — |
| | C3 | Owed-work register and run receipts | 8.1, 8.2 | S-M | register form; the restore rehearsal line |
| 2: invariants in code, $0 | C4 | Bound the database | 3.1-3.3 | S-M | — |
| | C5 | Budget in code | 4.1, 4.2, 4.5 | M | — |
| | C6 | Agent context and protocol | 6.1, 6.2 | M | — |
| | C7 | Captures and the public repo | 6.4, 6.8 | S | — |
| | C8 | Mail correctness | 6.7 | M | — |
| | C9 | Measure and alarm (**before ~10-13**) | 5.2, 5.3, 8.6, 2.5 | M | storage ceiling; ~$0.50/mo of alarms; the medium trigger |
| 3: before open beta, with Jamie's calls | C10 | Planner under saturation | 4.3, 4.4, 2.6, 2.7 | M | saturation ladder; Boards line |
| | C11 | Recording door and fleet | 6.6, 2.7, 2.4 | M | where the collectors are; a second site |
| | C12 | People's data and the privacy page | 6.3, 6.8 | L | open-beta approval; privacy answers; retention; erasure policy |
| | C13 | Shadow verification lane | 2.4 | M-L | sampling; an early trusted operator |
| 4: efficiency and surfaces | C14 | Hot-path efficiency | 5.1, 5.5-5.7, 2.5 | M | — |
| | C15 | Edge and deploy pipeline | 5.4, 8.4 | M | — |
| | C16 | Site surfaces and consistency | 7.5-7.7 | M | — |
| 5: product | C17 | A console people can navigate | 7.5 | M-L | — |
| | C18 | Console resilience and tests | 8.4 | M | — |
| | C19 | Battles features | 7.1, 7.3 | M-L | — |
| | C20 | Players and timeline features | 7.2, 7.4, 6.3 | M | — |
| | C21 | Written-issue pipeline | 6.7 | M | — |
| 6: the engineering system | C22 | Ops and process hardening | 3.3, 8.3 | M | — |
| | C23 | Infra hygiene | 8.5 | M | removal window; rollback lever |

**Why this order.**

- Wave 1 closes what an approved account could exploit today, while the
  private notes are fresh. It then builds the register every later chunk
  files its leftovers into.
- Wave 2 is the high-leverage $0 work: most of it is S effort, and none
  of it waits on Jamie apart from C9's small calls. C9 is time-bound:
  the 2 GiB storage alarm and the first autoscale arrive around 10-13
  to 10-18.
- Wave 3 is what open beta needs. Each chunk opens with Jamie's call. If
  an answer is not ready, skip ahead to wave 4 and come back.
- Waves 4-6 improve a working service, and can be taken in any order.

**Before open beta:** C1-C13, and C17 if the console is part of the beta
pitch.

**Dependencies:**

- C9 before C14: C14 measures its before and after with C9's
  `pg_stat_statements`.
- C17 before C18: C18's failed-write fixture exercises C17's `useWrite`.
- C19 before C20: both bump the contract, and running them in sequence
  keeps the changelog linear.
- C3 before anything that has leftovers.

---

## Wave 0

### C0 — Land the review — S

Open the PR for `claude/data-product-review-61awdw` (`gh pr create
--fill`, `gh pr merge --auto --rebase --delete-branch`). It is docs
only, so there is no deploy. After the merge, this brief is on `main`
for every later session.

---

## Wave 1: close what is exposed

### C1 — Door hardening I (private) — M

**Scope.** door-1 (high) and door-6 (low), from Jamie's private notes.
They cover the OAuth door's first-party determination and the credential
that the leaders-only fact rule accepts.

**Skills.** `migration` if a column is needed; `ship`.

**Decide before:**

- DECISIONS 68 and AGENTS.md define a first-party client as one whose
  redirect URIs are all on family origins. Approve redefining it as "a
  family client provisioned by an op, whose redirects are all on family
  origins".
- Approve revoking any client that the one-time audit finds claiming
  family redirects without being one of the family's apps.

**Sibling repos.** Elixir Clan and Elixir Drop, wherever their OAuth
`client_id` comes from. They must keep signing in across the change.

**Done when:**

- the private notes' refusal and derivation tests pass;
- Clan's and Drop's sign-in and their `/api/v1` reads work in
  production;
- the audit has run and Jamie has approved its revocations.

**Ship.** `--acceptance=elixir` (door-6 touches `elixir_timeline`
visibility), plus a signed-in read-back through Clan and Drop.

### C2 — Door hardening II (private) — M

**Scope.** door-2 (consent surfaces and revocation), door-3 (IP-keyed
limits, registration limits, the per-address sign-in bucket, and the
collector's `observed_ip`, which is non-sensitive and in the review),
door-4 (refused-credential persistence) and door-5 (attested-fact
overwrites). All from Jamie's private notes.

**Skills.** `ship`.

**Decide before:** none.

**Done when:**

- the tests the notes name pass;
- `/docs/limits` and `operators.md` describe the new behaviour, with no
  mechanics beyond what users need.

**Ship.** No acceptance. Run the smoke plus the invalid-Bearer 401
read-back at `/mcp` and `/api/v1`.

### C3 — Owed-work register and run receipts — S-M

**Scope.** §8.1 and §8.2.

- **The register.** Build it, with the test that fails on an item past
  its `until` date and on an unregistered "Needs Jamie" or "Owed" line
  in the current NOTES week. Seed it with:
  - this brief's chunks, by id;
  - the review's §9.3 calls still open;
  - the review's §9.4 measure-first list;
  - the "Needs Jamie" and "Owed" markers in NOTES.md and W38 that are
    still open.
- **Run receipts.** `objective-lease.mjs receipt`, a journal in `.git`
  that needs no lease, and `preflight`/`status` showing overdue
  objectives. Reconcile the three no-op instructions.
- **The restore decision.** Run `/consistency` on today's DECISIONS
  line. It will reach `run-elixir-mcp.md`'s quarterly restore rehearsal
  and anything else that assumes one.

**Skills.** `consistency`.

**Decide before:**

- The register's form: a tracked file enforced by `verify`, or GitHub
  Issues.
- Whether the Run objective's quarterly restore rehearsal goes. This
  follows from today's decision; `/consistency` will put it to Jamie.

**Done when:**

- the register exists with its test;
- every open marker in the current NOTES week has an id;
- `status` prints each objective's last receipt.

**Ship.** No deploy: docs, scripts and tests only. It still goes through
a PR.

---

## Wave 2: invariants in code, $0

### C4 — Bound the database — S-M

**Scope.** §3.1, §3.2, and the S part of §3.3.

- `PGAPPNAME`/`PGOPTIONS` per function in the template: a
  `statement_timeout` below each Lambda's own timeout, and
  `idle_in_transaction_session_timeout`.
- `lock_timeout` on the read-only tool path only.
- A migration in the 0155 shape for `client_connection_check_interval`.
- The invoker's deadline on Explore and `/api/v1`, and a time check in
  `packSets`.
- `terminate_backends` refuses `true` and a missing `like`, with a
  300 s floor, and filters by `application_name`.
- `oauth_grants` revoke in one transaction, with tests.
- Fix the web-api comment.

**Skills.** `migration`, `ops` (the catalogue for any op change),
`ship`.

**Decide before:** none. The DECISIONS "writes never race" line gets a
clause about the connection-wide ceiling.

**Done when:**

- on a scratch database, the per-call `set_config` still overrides the
  default;
- `{backends}` groups by `application_name`.

**Ship.** `--acceptance` (the invoker is shared).

### C5 — Budget in code — M

**Scope.** §4.1, the status and Admin lines of §4.2, and §4.5.

- The bucket is charged only for inserted rows, and planning runs
  against the queued backlog.
- Live mints are charged atomically, through one path, including
  `deck-cards`.
- The two-hour fleet-outage plan test.
- Honest `/api/public/status` and Admin capacity lines.
- The ~70% (or `due_starved`) feedback item.
- The marginal cost shown where access is approved.
- `ranking_health` counts admission and splits empty from not-found;
  Keep the Boards reads the new fields.
- The battle-log jitter clamp.

**Skills.** `ship`.

**Decide before:** none. Renaming `expected_hour` is a public status
field change, so update `/data/now`, the console and the docs in the
same PR.

**Done when:**

- the outage test holds;
- the next 10:05Z tick shows the bucket charged for live mints.

**Ship.** No acceptance; the live lane is excluded. Run the smoke plus a
status read-back one tick after the deploy.

### C6 — Agent context and protocol — M

**Scope.** §6.1 and §6.2.

- The brief's 2,048-character budget, ordered by value, with the
  50-player/10-clan test.
- Person schemas without `on_behalf_of`/`display_name`, stripped
  silently before validation.
- No `structuredContent` on error results.
- `MCP-Protocol-Version` validation.
- The unknown-argument hint names the contract version and says to
  reconnect.
- Measured client columns on quickstart.
- One real-client journey (`claude mcp add`) added to the Gym skill, to
  run once per release.
- Optional: trim the argument descriptions that carry no load (§5.7).

**Skills.** `tool-change` (bookkeeping), `ship`.

**Decide before:** none. As a preflight check, confirm that the Discord
agents read errors from the text block.

**Done when:** a real Claude Code session receives the whole brief (the
key sentences are present).

**Ship.** `--acceptance`. This is an MCP patch, with a CHANGELOG entry
and What's new.

### C7 — Captures and the public repo — S

**Scope.** §6.4 and the first bullet of §6.8.

- `calls/` noncurrent expiry of 1 day, and delete-marker cleanup.
- `acceptance/bites/fetch.mjs` strips or stubs `attested` and `account`
  items and gets a corrected header. `bites.test.mjs` fails on a
  committed bite that holds either. The committed `account` items are
  removed.
- `build-tracking` passes its `MOMENT_KINDS` filter to `buildTimeline`.
- A jobs test that a leader's tracking mail holds no attested kind.
- A test that only `entries.mjs` and `attested-facts.mjs` name
  `attested_fact`.

**Skills.** `ship`.

**Decide before:** none.

**Done when:** a `ListObjectVersions` on a `calls/` prefix older than
91 days is empty, one day after the deploy.

**Ship.** No acceptance: stack and jobs only.

### C8 — Mail correctness — M

**Scope.** The S parts of §6.7:

- **Weekly runs:** ledger-first recipients; `{sent, remaining, ms}` on
  the result line; a time budget; `EventInvokeConfig` with
  `MaximumEventAgeInSeconds` of about 3600.
- **Milestone:** keyed by the pass hour, with the two-moments test.
- **Written issues:** the period gate (send nothing, and notify the
  owner, when the period has none); `note` and `status` preserved.
- **`clan_report`:** composed at the clan's recording scope, with the
  reader-invariance test and weekdays formatted per recipient.

**Skills.** `ship`.

**Decide before:** none. The milestone fix realizes DECISIONS 143.

**Done when:** the next natural milestone, Monday and Wednesday runs log
`ms` and send without `already_sent` churn (read with `ops`).

**Ship.** No acceptance: mail only.

### C9 — Measure and alarm — M — before ~10-13

**Scope.**

- **§5.2:** the autovacuum migration.
- **§5.3:**
  - `pg_stat_statements` and a `{statements}` op;
  - the daily size and I/O row;
  - `MaxAllocatedStorage` set for a date;
  - the db.t4g.medium trigger written into NOTES.
- **§8.6:**
  - a metric filter on `tool_failed_unexpectedly` and
    `db_connect_failed`;
  - alarms on EBSByteBalance% and FreeableMemory;
  - web-api Duration p95;
  - ACM `DaysToExpiry`.
- **§2.5:** the `submit_ingest_error` filter and alarm.

**Skills.** `migration`, `ops`, `ship`.

**Decide before:**

- the `MaxAllocatedStorage` number (review §9.3 #3);
- about $0.50/mo of alarms, and optionally a Route 53 health check at
  about $3-5/mo (#8);
- the db.t4g.medium trigger wording (#9).

**Done when:**

- `{statements}` answers;
- the size row is written nightly;
- a week later, `{tables}` shows `deck_card`, `deck` and
  `meta_season_pop` all-visible above about 98% with no manual vacuum.

**Ship.** No acceptance: migrations, ops and stack only.

---

## Wave 3: before open beta, with Jamie's calls

### C10 — Planner under saturation — M

**Scope.**

- §4.3: class-first ranking, with the order taken from the ladder, and a
  plan test that has a budget below the eligible set.
- §4.4: the pre-reset watcher reads rosters first. Run the read-only
  count before building.
- §2.6: `poll_state.retry_at` with backoff, via a migration, and the
  10:05Z error test.
- §2.7: the roster ordering guard and the open-job check in
  `selectEligible`.

**Skills.** `migration`, `ship`.

**Decide before:**

- the saturation ladder (#4);
- Keep the Boards' "~400 is a defect" line against the sticky rule's 608
  (#5);
- whether to disable boards that stay empty or 404 for a whole season
  (about 90 fetches a day).

**Done when:** the next 10:05Z and Sunday 23:10Z waves show the new
order and the watcher's reduced forced set (PlannedJobs on the scheduler
EMF line).

**Ship.** No acceptance: scheduler only.

### C11 — Recording door and fleet — M

**Scope.**

- §6.6: 429 becomes retryable on submit. The hub's `submit_retry`
  envelope changes first. Then the collector release: candidate, soak,
  name (RELEASING-COLLECTOR.md).
- §2.7: `IfNoneMatch` on archive puts, the bucket-policy deny after a
  scratch-bucket test, and `MigrateRole` without `s3:PutObject`.
- §2.4: optionally, the owner-set private `site` label and
  `sites_active`.

**Skills.** `ship`, plus the collector repo's own process.

**Decide before:**

- where the five collectors physically are;
- a second site: the cabin, or a VPS at about $4-6/mo (#6, #13);
- whether one outside operator is admitted on a written trust decision.

**Done when:**

- a signed candidate is named and has soaked;
- a second failure domain is active, if Jamie chose one.

**Ship.** No acceptance: web-api and stack only.

### C12 — People's data and the privacy page — L

**Scope.**

- **§6.3:**
  - the `{account_erase}` op, dry-run by default, with steps in the
    review's order and the FK-enumeration test;
  - a contact route that needs no account;
  - privacy.md's answers;
  - the children line;
  - retention for never-approved access requests and `mail/sent/`.
- **§6.8, bullets 2-5:**
  - `member_away` and `clan_message` retention;
  - the erasure rule for facts by and about a person;
  - `departure_at`;
  - the attester's seat observation time;
  - optionally, an app's clan writes limited to opted-in clans.

**Skills.** `migration`, `ops`, `tool-change` (if `departure_at` goes on
the timeline item), `ship`.

**Decide before (#7):**

- Does open beta keep owner approval?
- privacy.md's text on recourse for recorded people without an account,
  under DECISIONS 41;
- the children floor;
- retention windows for access requests, sent mail, aways and clan
  messages;
- on erasure, what happens to collections the person owns, to their
  feedback rows, and to facts they attested.

**Done when:**

- a dry run of `{account_erase}` on a test account lists every row and
  object it would touch;
- privacy.md and limits.md state the answers and the windows.

**Ship.** `--acceptance=elixir` if the timeline item changes; otherwise
none.

### C13 — Shadow verification lane — M-L

**Scope.** §2.4, third bullet:

- a `trusted` flag on `gateway`;
- a verification job only trusted gateways may lease, inside the API's
  cache window;
- a stable-field comparator for battle logs;
- per-gateway agreement bookkeeping;
- probation made into a real control.

**Skills.** `migration`, `ship`.

**Decide before:**

- the sampling rates (about 10% on probation, about 1% forever);
- the activation threshold N;
- whether an operator goes active before the lane on a written trust
  decision.

**Done when:** a probation collector's agreement count is visible in
Admin.

**Ship.** No acceptance. Must be live before any stranger's collector
goes active.

---

## Wave 4: efficiency and surfaces

### C14 — Hot-path efficiency — M

**Scope.**

- **§5.1:** the capture overlapped with the audit; `describe()` only
  after the live lane; hints folded into the audit insert and the admit
  side into one CTE; `set_config` re-issued only on drift; `stampRead`
  throttled; `capture_ms` recorded.
- **§5.6:** the vocabulary cache at process scope; the rollup refresh
  sorted and batched; `poll_state` writes folded together.
- **§2.5:** a door retry on 40P01/23505, and the stale SQS comments
  fixed.
- **§5.7:** `popSelect` on `opp_deck_avg_level`; the activity job
  bounded.
- **§5.5:** measure first, then set the MCP Lambda's memory.

**Skills.** `ops` (for before and after readings), `ship`.

**Decide before:** none. Raising memory is cents a month, but it is
still Jamie's call under DECISIONS 160, so bring the measurement.

**Done when:**

- the DB-free tools' p50 drops;
- battlelog deadlocks in Logs Insights drop;
- `{meta_rollup_equivalence}` passes.

**Ship.** `--acceptance`.

### C15 — Edge and deploy pipeline — M

**Scope.**

- **§5.4:** one cached `/api/public/*` behaviour, with a smoke check
  that a repeat read is a Hit.
- **The console bundle diet:** subpath exports for contracts, a
  lazy-initialized `marked` in the kit, one stylesheet, and a gzip
  ratchet.
- **§8.4:** CI builds the site once; publishing is ordered, with
  Cache-Control on assets and documents.

**Skills.** `ship`.

**Decide before:** none.

**Sibling repos.** Elixir Clan takes the kit change through its pin.

**Done when:**

- `/account/overview`'s gzip JS drops by about 60 KB;
- a deploy no longer breaks lazy chunks.

**Ship.** No acceptance: web and stack only.

### C16 — Site surfaces and consistency — M

**Scope.**

- **§7.6:**
  - What's-new GUIDs become permalinks, capped at about 50 items;
  - contract versions go in the feed, or a second feed;
  - add `/feed.json`;
  - `llms-full.txt` is trimmed, with a size ceiling.
- **§7.5:** an honest 404, and the edge function extracted to
  `infra/edge/router.js` for the tests.
- **§7.7:** the builders example and "ten weeks", through
  `/consistency`; the Glue enum pinned to the projectors.

**Skills.** `consistency`, `ship`.

**Decide before:** none. Announce the one-time feed replay in What's new.

**Done when:**

- `feed.xml` GUIDs are unique and free of index numbers;
- `/docs/not-a-page` answers the 404 page;
- the Glue enum test passes.

**Ship.** No acceptance: site and stack only.

---

## Wave 5: product

### C17 — A console people can navigate — M-L

**Scope.** §7.5, bullets 1-3.

- **Links:** a kit `Link`; `LogCell {text, href}`; the Rail checks
  modifier keys; actions become `<button className="link">`; a ratchet,
  then `jsx-a11y` `anchor-is-valid`.
- **Writes:** `useWrite` and `WriteError`, security-relevant sites
  first, with a ratchet on bare writes.
- **Explore:** the record seeded from the probe; the war week read by
  `season_id`/`section_index` and rendered as plain tables.

**Skills.** `ship`.

**Decide before:** none.

**Sibling repos.** Elixir Clan takes the kit change through its pin.

**Done when:**

- both ratchets reach 0;
- every record link opens in a new tab.

**Ship.** No acceptance: console only.

### C18 — Console resilience and tests — M

**Scope.** §8.4, bullets 1 and 4.

- **e2e:** fixtures for a 503, a timeout and an HTML 502; journeys for
  "could not be read" versus "no such X", a failed write, Explore
  records, the agent console and Admin; axe on sample static pages.
- **Router, the cheap slice:** kit
  `pendingComponent`/`errorComponent`/`notFoundComponent`, which closes
  M1/M2; `queryOptions` and loaders with `defaultPreload: 'intent'` on
  the record pages.

**Skills.** `ship`.

**Decide before:** none.

**Done when:** a failed read is never shown as absence (M1/M2 closed).

**Ship.** No acceptance: console only.

### C19 — Battles features — M-L

**Scope.**

- **§7.1:**
  - first, pull `mcp_call_audit` for event-mode `battles_query` paging;
  - then `group_by: "event"` on `battles_performance`;
  - then the `event_tag`/`tournament_tag` filter on `battles_query`
    and `battles_performance`;
  - rewrite `EVENT_POOL_NOTE`.
- **§7.3:** `unrecorded_after`/`unrecorded_before` on `capture_audit`
  (a migration); overlap counts, and streaks cut at a gap; one
  completeness note; intervals in `elixir_coverage`.

**Skills.** `tool-change`, `migration`, `ship`.

**Decide before:** none. New arguments on existing tools are within
`tool-change`. Check the JSON API mirror for `battles_query`.

**Done when:** a gapped player's `current_streak` stops at the gap and
says so.

**Ship.** `--acceptance=battles,elixir`. This is an MCP minor, plus a
JSON API minor if a mirrored operation changes.

### C20 — Players and timeline features — M

**Scope.**

- **§7.2:** a `card_form_unlocked` moment, going forward; `changes[]` on
  `players_collection`; a choosing-a-tool row.
- **§7.4:** a stable `id` on timeline items, mirrored in
  `/api/me/timeline`.
- **§6.3:** a cursor passthrough on `GET /api/v1/players/{tag}/battles`.

**Skills.** `tool-change`, `ship`.

**Decide before:** none. Any archive fill of card history is out of
scope (it is Jamie's call).

**Done when:** the next form unlock after the deploy appears on the
timeline.

**Ship.** `--acceptance=players,elixir,battles`. This is an MCP minor
and a JSON API minor.

### C21 — Written-issue pipeline — M

**Scope.** The rest of §6.7.

- The Top 100 moves onto `issue-pipeline.mjs`, with a force flag and
  `kind`.
- A late accept sends the issue.
- Refusal, `max_tokens`, the turn limit and bad JSON are final; only
  429/5xx/connection errors retry.
- A cache breakpoint goes on the brief block.
- `numbers_used` digits are checked against their paths.
- Numbers are bound to entities by the sentence's name.

**Skills.** `ship`. `claude-api` for the cache breakpoint.

**Decide before:** none.

**Done when:**

- the reproduced rotated-ratings case fails the lint;
- the next Thursday Top 100 and Friday Card of the Week send on their
  own periods.

**Ship.** No acceptance: jobs and editor only.

---

## Wave 6: the engineering system

### C22 — Ops and process hardening — M

**Scope.**

- **§3.3, the M part:** a declared ops registry
  `{mode, heavy, log, run}` whose dispatcher opens the session:
  read-only sessions, `application_name` and `statement_timeout`, a
  `confirm` flag or dry-run default for writes, and summary-only logs
  where needed. Also an `ops_run` row per invocation, a catalogue test
  that compares mode and heavy, and a registry for the jobs Lambda's
  payloads.
- **§8.3:**
  - a scheduled, validate-shaped workflow at clock-sensitive UTC times;
  - a `pinClock` helper with its ratchet;
  - a batch marker that `deploy.mjs` refuses on;
  - the decision-citation test.

**Skills.** `ops`, `migration`, `ship`. Run `test-workflows.sh` after
the workflow change.

**Decide before:** none.

**Done when:**

- `ops.md`'s Does column is checked by the test;
- the scheduled workflow has run once.

**Ship.** No acceptance: migrate Lambda and CI only.

### C23 — Infra hygiene — M

**Scope.** §8.5.

- `SESSION_SECRET_PREVIOUS`/`ORIGIN_SECRET_PREVIOUS`, and an unsubscribe
  key id.
- `sslmode=verify-full` with the RDS CA bundle.
- A rotation runbook.
- `ApiGatewayManagedOverrides` plus access-log groups.
- A decisive smoke: one authenticated `tools/call`, and a 401 from
  collector config.
- The `/api/v1` contract-routing test, the facts `security` blocks, and
  unexpected errors mapped to 500.
- Optional: backup and maintenance windows set clear of the 10:00Z peak
  (availability, not restore).

**Skills.** `ship`.

**Decide before:**

- an MCP removal window once non-family clients exist (DECISIONS 54,
  #10);
- a `deploy.mjs --rollback` lever (DECISIONS 176, #11);
- per-service database roles, now or later (#12).

**Done when:**

- a secret rotates in a rehearsal with no sign-out;
- stage settings no longer drift outside the template.

**Ship.** No acceptance: stack only.

---

## Not scheduled

- **Measure-first items** (the review's §9.4): the result cache,
  `card_keys`, per-container connection reuse, the mail compose fan-out
  and per-run memo, day-major archive bundles, per-actor worktrees, and
  the Atom/JSON timeline feed. C3 puts them in the register, each with
  the measurement that would trigger it.
- **Off-account replication of the archive (`payloads/`).** This is
  separate from database restore. The risk it covers is account-level:
  a bad credential against the S3 record. It is not scheduled, and it is
  available as a standalone chunk if Jamie wants it.

## Tracker

- [ ] C0 Land the review
- [ ] C1 Door hardening I
- [ ] C2 Door hardening II
- [ ] C3 Owed-work register and run receipts
- [ ] C4 Bound the database
- [ ] C5 Budget in code
- [ ] C6 Agent context and protocol
- [ ] C7 Captures and the public repo
- [ ] C8 Mail correctness
- [ ] C9 Measure and alarm
- [ ] C10 Planner under saturation
- [ ] C11 Recording door and fleet
- [ ] C12 People's data and the privacy page
- [ ] C13 Shadow verification lane
- [ ] C14 Hot-path efficiency
- [ ] C15 Edge and deploy pipeline
- [ ] C16 Site surfaces and consistency
- [ ] C17 A console people can navigate
- [ ] C18 Console resilience and tests
- [ ] C19 Battles features
- [ ] C20 Players and timeline features
- [ ] C21 Written-issue pipeline
- [ ] C22 Ops and process hardening
- [ ] C23 Infra hygiene

---

_This material is unofficial and is not endorsed by Supercell. For more
information see Supercell's Fan Content Policy:
www.supercell.com/fan-content-policy._
