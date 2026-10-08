# Elixir notes

Working notes: what is open, what is queued for Jamie, and dated entries
for the reasoning behind a change. What still stands is
`docs/DECISIONS.md`, one line per ratified decision and declined idea;
read it before proposing anything. Earlier entries are in git
(`git log -- docs/NOTES.md`); the last full version is at `bb01d62b`
(`git show bb01d62b:docs/NOTES.md`), and the weekly archives that sat
in `docs/notes/` are listed in `docs/archive/README.md`.

## Open and queued

One line per item: when it was raised, what it needs, and who owns it.
Remove a line in the change that closes it.

### Jamie

- 2026-09-28: retire `session_secret_previous` on or after 2026-12-27.
  Deploy with `--param=SessionSecretPreviousInSecret=false`, then remove
  the key in the console (`docs/SECRETS.md`). Jamie.
- 2026-10-08: delete `elixir-clan/app` (keep the default recovery
  window) once the deploy that reads `elixir-mcp/app:clan_sealing_secret`
  has succeeded; Jamie copied the value across the same day. Jamie.
- 2026-10-04: privacy.md still says AI models "write some of the mail"
  and help with feedback, which is the retired editorial claim; also
  decide whether to name Clan's own-key model flow. Product wording,
  Jamie.
- 2026-10-05: Ship It! and Elixir Kings report `channels_ok: 0`. Restore
  each ask-channel binding or permission, then restart only the repaired
  instance. Jamie (Operator follow-up).
- 2026-09-29: `min_client_version` is 2.0.30 with enforcement on. Raising
  it retires the pre-signing rollback lever. Jamie.
- 2026-10-07: beta invitations not sent. Open before inviting: a real
  inbox delivery and a natural first capture (a separately approved
  controlled fresh-person path); the acceptance plan awaits the exact
  inbox, player tag and baseline. Jamie.
- 2026-10-03: co-leaders' own sign-in, verification and model-status
  read-back, any reviewed historical manual-award reconciliation, and a
  bounded paid drafting attempt remain live checks. Jamie with the
  co-leaders.
- 2026-09-27: growth priorities, held: the saturation ladder and planner
  class order, a pre-reset watcher, the `MaxAllocatedStorage` ceiling
  (100 GiB in the template) and a written trigger for a larger database
  instance. Jamie.
- 2026-09-27: collector-fleet trust, held: where the collectors are and
  a second site, a written trust decision before an outside operator's
  collector goes `active`, shadow verification
  (`docs/COLLECTOR-ZERO-TRUST.md`), and off-account replication of the
  payload archive. Jamie.

### Engineering

- 2026-10-03: optional RDS downsizing (db.t4g.small, 20 GiB) waits a
  couple of weeks of measurements. Operator.
- 2026-09-28: one rate budget with no per-key pooling; revisit around
  2026-10-28. Operator.
- 2026-10-03: a recomposed closed week's collector credits can differ by
  one: it uses current lifetime points, not the period-end total.
- 2026-10-04: ordinary removal stays held until there is an all-mode
  coverage contract and receipt-bound counter tuples. Clan.
- 2026-10-05: membership counts changed while the join and departure
  lists were empty; cause unconfirmed. Data Auditor.
- 2026-10-05: a `live: true` race read that lands in matchmaking still
  says "The live fetch returned a payload our admission rejected."
  (`packages/tools/src/tools/shared.mjs`) and the receipt stays
  `rejected`.
- 2026-10-04: #292, Clan History browsing older recorded membership
  changes. Open.
- 2026-10-04: #296, slow warm Awards participation reads. Needs browser
  Network/Server-Timing evidence if it recurs.
- 2026-09-16: schema index diet, not started: drop
  `battle_participant_player` and `battle_participant_window`; a partial
  `clan_membership (clan_tag) where left_observed_at is null`; seed the
  Training Camp arena (54000001) and add the
  `player_snapshot_daily.arena_id` FK; `api_receipt.job_id` FK
  `on delete set null`; rename `poll_state.subject_tag` to `subject_key`;
  comments on the declined FKs.

### Parked, with their triggers

- 2026-09-27: measure with the `{statements}` op before changing any of:
  invoker fixed cost, a result cache, per-container connection reuse, MCP
  Lambda memory, the nightly and activity tidies.
- 2026-09-27: wait for scale: mail compose fan-out once a weekly run
  passes about 450 s; a split recording door.
- 2026-09-27: tool features, on a consumer ask: gaps as a precise
  control; an event as a population (`group_by: "event"`); a card's
  `changes[]` history; a supported-clients matrix.
- 2026-09-27: engineering system, when it pays: an ops registry with
  enforced modes, run receipts, scheduled CI with a pinned clock, a
  deploy batch marker, decision-citation tests, API Gateway managed
  overrides, a decisive smoke, e2e failure fixtures and router adoption,
  honest 404s, an `llms-full.txt` trim, a console bundle diet.
- 2026-09-27: low-value hardening: roster ordering, attested-fact extras.

## Entries

Newest last. Each entry is `## YYYY-MM-DD — title`, then what changed and
why. A ratified decision also gets its line in `docs/DECISIONS.md` in the
same commit.

## 2026-10-08 — internal docs describe the current state

The internal docs were trimmed to what is true now: `docs/EMAIL.md`
(six kinds, with `clan_actions_waiting` and the collector upgrade notice),
`docs/SECRETS.md`, `docs/COLLECTOR-ZERO-TRUST.md` and
`docs/RELEASING-COLLECTOR.md`. Finished reviews (`docs/reviews/`), the
archive bodies, the weekly notes (`docs/notes/`) and the retired
`docs/card-of-week/` and `docs/top100/` prompts were deleted; git keeps
them, and `docs/archive/README.md` maps each old path to the commit that
holds it. Their open items are the list above. Code comments that cited a
review section keep their substance without the citation; shipped
migrations and the changelog still cite the old paths.

## 2026-10-08 — the database goes back to db.t4g.micro

Jamie's call. The small (2026-09-23) carried a record the tracked-only
correction has since removed, while the reserved instance bought on
2026-09-07 is a micro: size flexibility made it cover half the small,
and the other half billed on demand (about $11.70 a month). Since the
correction: CPU about 5% average with credits at max, 0-2 connections,
reads in KB/s apart from a daily burst near 09:00Z, about 690 MB
freeable on the small.

The purge left the files five times the data. `{rewrite_table}` (VACUUM
FULL) ran on the small first, about 14:15Z, under the session lease:
`deck_card` 853 MB to 228 MB (6 s), `battle_participant` 2,235 MB to
210 MB (8 s), `battle_participant_card` 3,766 MB to 414 MB (22 s). The
database went from 8.2 GB to about 2.2 GB.

The deploy changes the class (a few minutes of downtime, single-AZ)
and lowers `elixir-mcp-db-freeable-memory` from 150 MB to 64 MB; the
old micro idled at 80-260 MB and would have held the 150 MB alarm.
shared_buffers stays the engine default. The micro's real limit is EBS
throughput: about 4.7 MB/s once the byte balance is spent, as the Gym
sweep did on 2026-09-23. Space heavy sweeps, backfills and full
acceptance runs; `elixir-mcp-db-ebs-byte-balance` (25%) says when not.

## 2026-10-08 — Clan's sealing secret moves into the app secret

The stack read Clan's sealing secret from `elixir-clan/app`, the old
standalone Clan app's secret, through the `ClanModelSecretName`
parameter. It now reads `clan_sealing_secret` from `elixir-mcp/app`, and
the parameter is gone, so Elixir has one app secret. The value moves
unchanged: `src/sealed.mjs` derives its keys from the value with a fixed
salt, so the same value in another secret opens every stored model key.
`anthropic_api_key` was removed from the app secret the same day (read
by nothing). Jamie copied the value into `elixir-mcp/app` before the deploy; the old
secret is deleted after it ("Open and queued").

## 2026-10-08 — a green PR merges without catching up to main

Jamie's call. The main ruleset no longer requires a branch to be up to
date with main (`strict_required_status_checks_policy` off on ruleset
24050992). Auto-merge never updates a branch, so with two PRs open the
second sat green and behind until someone ran `gh pr update-branch`;
sessions had taken to merging by hand, which looked like auto-merge
never firing. GitHub's merge queue needs an organization-owned repo.

Nothing untested reaches production: `ci-gate.mjs` takes a PR head's
green check only when its tree is main's new tip, so a PR merged behind
main makes the deploy wait for main's own `validate` run, which always
runs the journeys. Two PRs that pass alone and break together now turn
main red after the merge instead of stalling it; fix forward by PR.
Everything else in the ruleset stands.

## 2026-10-08 — feedback becomes one system

Jamie, a beta gate: "one general feedback system that can work for all
of the types of feedback that we want to collect in Elixir". The decisions
Jamie agreed to are DECISIONS' "Feedback is one system", with the Feedback
Manager running daily for beta (the response-time promise kept rather than
softened).

Part one (backend): migration 0204 adds `feedback.area`, `via`,
`follows_id`, `response_mailed_at` and the `feedback_ref` table, backfilled
from `request_id`, `context.request_ids` and `send_id`; those three stay
written for one release (expand-contract) and a later migration drops
them. `@elixir-mcp/feedback` is the one service: filing (refs checked
against the filer, a bad pointer dropped and named, never the report),
the filer's list and item (an item opened is an answer read), the answer
(compare-and-set; new words are news again; a status alone is not), the
queue (area, status, category, unanswered; paged by id; counts by area)
and the backlog the ops lanes read (`{feedback_pending: {area}}`). The
MCP tools, the web routes, `/api/v1/feedback` (JSON API 3.1.0) and the
ops lanes all go through it. The `feedback_answer` mail kind and its drain
(`services/jobs/src/email/feedback-answers.mjs`, settled ten minutes,
skipped when already read, never the owner) ship here unwired; part two
wires it beside the Console's item page its link opens.

Part one shipped as #364 and deployed the same day (migrations ran 0204;
smoke green; `{feedback_pending}` answered with `by_area`, nothing
pending). The acceptance run had five failures none of this touched,
and each reproduced alone: gym 132.4 and 332.5 (a "NOT comparable
across rows" note), gym 312.2 (live participants 44, expected 47),
`elixir_data_insights#0` at 6.6 s over its 6.1 s ceiling (the database
went back to db.t4g.micro this morning) and `elixir_timeline#docs`
(documented fields no response carried this run).

Part two: the kit's `FeedbackSheet` (one modal, native `<dialog>`) at the
foot of Ladder's and Clan's rail, and Clan's **Report this** beside an
action (refs `clan_action`, `clan`, `player`), Standing (`policy`) and
the award races (`award config:v<n>`), category `judgment`. The Console's
item page reads `/api/me/feedback/<id>`, shows the area, the refs and
the thread, and replies with `follows_id`; the admin queue filters by
area on the server (unanswered, oldest first by default) and answers
with `shipped_in` as a compare-and-set. Clan's own feedback store,
routes, views, ledger methods, `{clan_maintenance}` feedback/respond
lanes and `CLAN_MAINTAINER_TAGS` are retired (the store held nothing:
the lane read total 0 on 2026-10-08); `/clan/feedback` and
`/clan/maintain` now forward to the Console. The `feedback_answer` drain
is wired on the one-minute rule. The Feedback Manager runs daily
(manifest; the installed Codex automation follows).

Still to do: a contract migration that drops `feedback.request_id`,
`send_id` and the `context.request_ids` writes once nothing reads them;
Clan's empty `feedback#` rows (none exist) need no cleanup; and the
Discord agent passing `on_behalf_of` when it relays a member's feedback
(elixir-mcp-discord). Integrations made before 3.1.0 need
`feedback:write` granted to use `/api/v1/feedback`.

