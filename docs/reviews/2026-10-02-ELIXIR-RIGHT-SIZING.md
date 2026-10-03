# Elixir right sizing implementation plan

This is an engineering assessment and removal plan, prepared for Jamie on
2026-10-02. It is not a release receipt or a second product specification.
The product's purpose belongs in [About Elixir](../../apps/site/src/docs/about.md).
The feature retirements are deployed: Drop automatic enrollment (PR #73),
Collections (MCP 10.0.0 / JSON API 3.0.0), global boards, game-wide
statistics, recommendations and editorial infrastructure (MCP 11.0.0).
Clan shares the Elixir session, application and Postgres ledger after a
complete frozen-state comparison; its legacy infrastructure has retired.
Jamie approved the original private history manifest on October 2. Its bounded
database purge stopped after 15,055 completed batches and a rolled-back battle
transaction. A replacement manifest preserves the selection and completed
receipts while reducing battle batch size; Jamie authorized its resume on
October 3 under the exact replacement digest. That run completed 34,525
selected battles before an admitted-observer race rolled back its next
transaction. Jamie chose to finish in the current database. A faster grouped
manifest preserves all selection and receipts; Jamie approved its exact
digest and collector window on October 3, subsequently prioritizing completion
and extending the pause. Database, retained-history verification, exact original
S3-version deletion, temporary cleanup, post-delete vacuum and runtime
cleanup are complete. Migration 0199 contracts the empty retired tables in
a separate release after the last readers retired. The authoritative execution
receipts belong in `docs/NOTES.md`. The assessment measurements and original
implementation inventory below remain dated engineering context.


Jamie confirmed that global leaderboard capture and history should go, while
rank information delivered in a recorded player's profile stays. Full Clan
consolidation is in scope: moving it into this repository and onto the same
hostname did not finish that work. Ultimate Champions and Card of the Week
are removal targets from the original request. Jamie also confirmed removal
of game-wide meta statistics and recommendations: "Recommendations are
going OUT. Game wide meta OUT." These removals are settled scope, including
public corpus statistics, corpus analysis, deck sets and upgrade advice.
Jamie subsequently confirmed retirement of all named recording Collections.
Existing primary/alt/friend/watching relationships already organize followed
players; no replacement grouping feature is needed.
Drop's automatic collection enrollment is also a confirmed removal, without
a replacement integration enrollment feature.
Other proposed cuts below remain separate decisions.

## Current scale and the limits of the measurements

Read-only production measurements on October 2 used the existing migrate
operations `{stats: true}` and `{tables: true}`, one invocation at a time,
under the verified cloud-engineer identity. Both completed without a function
error. Public status reported a healthy recorder. Source was assessed at
`62032320`, contract 9.19.3; the JSON API retains its separate version.
Raw operation results and individual records are not included in this public
document.

| Measurement | Observed value | What it establishes |
| --- | ---: | --- |
| Accounts | 33 | The current account population, including non-person accounts |
| Active recordings | 1,027 | Recorder rows, not the full population polled through clan membership |
| Active recordings with ranking origin | 686 | How those recordings began, not how many can safely stop |
| Battles | 653,635 | Exact current count; no deletion classification yet |
| Database size | 9.41 GB | Allocated database size, including indexes and free space |
| Battle, participant and played-card tables | 6.25 GB | The three largest battle storage components together |
| Player and clan ranking entries | About 1.91 million rows, 403 MB | Estimated rows from table statistics; allocated table and index bytes |
| Meta population and deck season tables | About 631 MB | Population plus deck rollups, including bands; excludes smaller meta tables |
| Enabled regional Path of Legends locations | 262 | Regional capture exists alongside the global board |

The archive's object count and bytes, exact removable battles, legitimate
recording overlap, and monthly savings have not been measured. These are
required census outputs, not estimates to infer from the 686 ranking-origin
recordings. Stopping elite capture should reduce future work; deleting rows
does not automatically lower the RDS bill or shrink its provisioned disk.

## Capability disposition

| Capability | Disposition | Work required |
| --- | --- | --- |
| Deliberately recorded players, friends and clans | Keep | Preserve recordings and useful history, including past requests |
| Personal season, battle, day, deck and card views | Keep | The existing Ladder reads personal history; do not confuse its name with global boards |
| Clan management | Consolidate | Preserve the useful engine and clan records inside Elixir |
| Milestone, personal week, friends, clan and action emails | Keep | Record-driven mail is core; preserve preferences, send history and deduplication |
| MCP connection | Keep as an extension | The website and emails remain useful without an agent connection |
| Versioned JSON API and external integrations | Keep | Clan becoming internal does not retire Drop's or another caller's public contract |
| Drop sign-in with Elixir and authorized account access | Keep | Retire automatic collection enrollment separately; preserve Drop's OAuth client, consent and authentication flow |
| Global boards and historical season finals | Remove | Scheduling, ingest, tools, collections, archive and replay sources all go |
| Regional, clan and rotating-mode boards | Remove | Keeping them retains the same capture and maintenance machinery; personal profile rank stays |
| Automatic recording of ranked players and board collections | Remove | Reconcile every remaining legitimate recording reason before stopping capture |
| Ultimate Champions and Card of the Week | Remove | Builders, generation, schedules, templates, switches and future-send paths |
| Public corpus card/deck statistics and corpus analysis | Remove | Includes public card performance pages, home-page meta, global season rollups and corpus segments |
| Deck sets, upgrade advice and other gameplay recommendations | Remove | Retire corpus priors, candidate generation, form-advantage scoring and recommendation tools; do not recreate them over friends or a smaller recorded population |
| Card catalog, card art, deck identity and factual personal card history | Keep | Used by recorded battles and the remaining interface; remove editorial content without deleting these foundations |
| Named player and clan recording Collections | Remove | Transition deliberate user tracking and integration enrollment, then remove collection capture reasons, tools, UI, quotas and storage; existing tracking relationships remain |
| Global event and tournament collection | Recommend cutting autonomous capture | Keep event facts delivered in people's battles; verify catalog needs before removing an endpoint |
| Clan social map and bring-your-own-model drafting | Review separately | Not necessary to remove elite capture; do not migrate complexity by default or delete private records implicitly |

## Original implementation inventory

The collector is not the policy owner. `packages/ledger/src/plan.mjs` chooses
what to fetch; the fleet only leases and submits it. Removing a board from a
page does not change capture. Disabling `ranking_board` is insufficient:
the planner independently seeds the leaderboard list, events, global
tournaments and past season finals. A missing final snapshot is itself an
eligibility condition, so deleting history before removing that path causes
it to be collected again.

`packages/ingest/src/rankings.mjs` makes board presence a recording reason.
`packages/claims/src/index.mjs` combines claims, account-clan membership,
collections, ranking presence and ops recordings. Ops recordings are exempt
from automatic stopping, and an active row's origin does not change when
another person starts following it. Stopping ranking-origin rows alone
therefore both misses some elite capture and risks stopping wanted subjects.

`clients/boards/boards.mjs` manages `pol-global-top-100`, `pol-us-top-100`,
`pol-jp-top-100` and `global-top-10-clans`. The repository manifest and the
installed `keep-the-boards` automation both remain ACTIVE at assessment.
Retirement must update both; removing only the manifest does not stop the
installed writer. The client's README also describes a launchd sync;
inventory its live installation rather than assuming the Codex schedule is
the only writer. Revoke its narrowly associated credential after its work
is retired, without touching unrelated integrations.

The two editorial kinds span `services/jobs/src/email/`, `packages/mail/`,
`services/editor/`, the outbox editor lane, queues and infrastructure rules.
The editor serves these issues; verify all callers before removing the
Lambda, its IAM role, model parameters, queue, alarm and secret references.
The SES relay and ordinary mail outbox must stay. Pending editorial work
must be suppressed at the final send boundary, not only at composition.
Previously sent email records and unsubscribe links need to remain usable.
Remove the raw leaderboard allowlist in `packages/tools/src/live.mjs` too,
so an agent cannot reintroduce board history through a live request.
Retire the recommendation prompts in `apps/site/src/_data/examples.js`,
agent initialization guidance and public card performance links as part of
the same change; examples must not route readers back into removed tools.

`services/jobs/src/meta-rollup.mjs` and `packages/tools/src/meta-season.mjs`
maintain a population cache and season aggregates beyond the personal
record. These also supply priors and candidates to deck recommendations.
Both game-wide meta and recommendations are now confirmed removals. Trace
and remove their readers and derived caches as well as their jobs, including
`battles_meta_decks`, `battles_meta_cards`, `battles_deck_sets` and
`battles_deck_upgrades`. Review `cards_card`, `cards_synergy`, trends and
badge corpus branches for the same global dependency. Keep factual personal
and clan reads through narrow paths with no corpus prior, global comparison
or recommendation score. The retained record can answer what someone
played, faced or achieved; a recommendation over friends is not a replacement
feature in this plan.

## Collections retirement

Retire all named player and clan recording Collections, including public,
private, manually curated and board-managed groups. Keep the existing
primary/alt/friend/watching classification and private nicknames on followed
players. Do not build replacement labels, suggested-account curation,
always-on creator recording or popularity-based quota exemptions.
Keep a player's recorded owned-card collection (`players_collection`, card
levels and form unlocks); that is game history, separate from named recording
groups.

Inventory collection ownership, membership, scope, attribution and history
before changing recording reasons. Separate deliberate requests from board
sync, autonomous curator/ops capture and external integration enrollment;
ownership alone does not establish a person's intent. Preview deduplicated
ordinary player/clan tracking for legitimate personal requests, preserving
existing relationships, primary identity and clan scope. Do not infer an
alt/friend relationship or convert board populations into user follows. Check
the person's pooled player/clan quotas before migration; capacity conflicts
need a reviewed transition, never silent overflow or dropped requests.
Do not mechanically call ordinary tracking for every member: a first player
becomes primary, and direct player tracking requests comprehensive scope.
Any approved conversion needs explicit identity, scope and notification
dispositions so it cannot silently change the person's primary or deepen
capture from an activity-only group.
Retained historical recording evidence must survive removal of the collection
tables for the purge census and its audit trail.

External integrations currently enroll through collection grants and
`/api/v1/collections` operations. Trace Drop's deployed enrollment consumer
and each active grant. Jamie confirmed removing automatic collection
enrollment from Drop too; do not introduce a replacement integration
enrollment feature. Retire dependent callers before the old operations and
grants. Resolve any other active consumer explicitly rather than silently
breaking it or moving its population into the sponsor's player slots.
Removing those operations is a breaking JSON API change requiring its own
version/cutover. Keep unrelated profile reads, asynchronous refreshes,
OAuth and other external API operations.
Jamie explicitly confirmed that Drop using Elixir for account authentication
and gaining authorized account access is a useful feature within scope. Its
OAuth client, consent and sign-in stay; only Clan's internal OAuth loopback
is removed during consolidation.

Drop's `services/api/src/refresh-worker.ts` currently awaits collection
enrollment before requesting a profile refresh. Removing enrollment first
would strand those queued jobs. Remove that awaited call, enrollment helper
and client operation, collection configuration, sync script, associated
tests and deployment parameters in Drop's own reviewed change. Verify queued
profile jobs still refresh, then deploy Drop before removing Elixir's
collection endpoint and grants. The person's OAuth `/me/players` path
already exists separately and stays. Anonymous
or integration-supplied tags must not become the sponsoring person's follows.

Once legitimate requests have another recording reason, remove collection
writers, recording predicates, quota buckets, MCP declarations and schemas,
Console routes/query hooks, admin operations, API grants and operations,
segment selectors, examples, docs and dead jobs. Use ordered migrations for
storage cleanup; preserve immutable historical migrations. Reconcile capture
from the remaining reasons, including outstanding ops exceptions. Stopping
collection-only capture does not itself authorize deleting its history:
the same reviewed provenance and overlap manifest decides what can go.
`services/web-api/src/routes/collections.mjs` also implements retained
`/api/me/clans` routes: separate those handlers before pruning collection
code rather than deleting the module wholesale. Retire collection OAuth
scopes and consent copy too. Retire integration collection grants before
collection rows because their foreign keys prevent collection deletion.

## Clan consolidation target

Retain the static site and one React application. Put personal record,
friends, clan and account features in that application's routes and shared
query cache. Preserve useful existing URLs where practical; a route named
`/clan` can remain without a separate application behind it. Product sections
should read as features of Elixir. Console, Ladder and Clan need not be three
products or three separate onboarding paths.

Use Elixir's session and account identity directly for internal feature
requests. Remove Clan's OAuth loop back into Elixir, stored access and
refresh tokens, second cookie, refresh locking, family client and internal
integration key once their last deployed consumer is gone. Preserve the
audience separation and no-cookie routing of the external MCP/OAuth doors.
External clients continue to use OAuth and `/api/v1`.

Move the pure management engine out of `clan/services/engine` into a shared
package. Put its persistence in Postgres through an ordered migration and
an explicit import operation. Root web-api routes and scheduled jobs use
that package and the same record functions. Packages still never import
service internals. The current test forbidding all Clan imports except the
kit is replaced by the meaningful boundaries: collectors alone admit game
facts, policy decisions remain distinguishable from game facts, and private
clan information is gated by current verified identity and in-game role.

The import must account for policies and their versions, actions and stable
numbers, action logs, holds, notes, awards, recruiting settings, preferences,
away status, private social data, feedback, schedule claims and mail
watermarks. Counts, stable identifiers and redacted content hashes must
match. Do not import temporary login/session records or OAuth token pairs.
Preserve attestation provenance and every existing visibility rule.
Inventory the whole DynamoDB table by item type: the ByClan index excludes
several preferences, keys, counters and schedule records. Keep existing
attested-fact source identifiers and correction references even where an
identifier spells a retired hostname; changing it would duplicate facts.
Management authority comes from a verified own player and their current
role; following a friend never confers authority over their clan.

Existing sealed model keys use Clan's session secret. Their ciphertext
cannot simply be copied to a service using Elixir's different secret.
If drafting stays, handle re-encryption entirely at runtime with a bounded
import and no plaintext in logs or agent context. Otherwise settle retirement
and address retained keys explicitly. No key extraction for inspection.
Root database Lambdas have no internet egress; keeping model drafting also
requires a deliberate worker/outbox path after the editorial worker leaves.
That makes retiring BYOK drafting a useful additional simplification, pending
its own product decision. Deterministic action and recruiting text can stay.

Cut over one authoritative writer at a time. Pause Clan evaluation and writes
for the final import, reconcile the tail, switch routes and schedule together,
and carry over send watermarks so actions are not emailed twice. Retire
the separate frontend build, deploy workflow, stack and DynamoDB store only
after the new path passes read-back and the agreed rollback interval ends.
The old DynamoDB table has retention and deletion protection: removing the
stack alone will not remove that remaining store or its bill.
Consolidation is complete when normal use and deployment require only Elixir;
directory moves alone do not satisfy it.

## Permanent deletion method

### Establish what stays before selecting what goes

Build a private, deterministic census of recording reasons. Include people's
players and friends, legitimate historical collection requests, recorded clans and their
membership, narrow external-integration grants, and deliberately retained
operator subjects. Review legacy ops/pro recordings explicitly. Historical
requests and clan membership matter: the current roster and today's claims
alone cannot justify deleting someone else's earlier record.

Classify each affected subject and time range as retained, removable or
unresolved. Unresolved evidence is reported for review and retained until
resolved. Name every retired collection and its classified purpose explicitly; do not infer
their purpose from the owner's account or an origin enum.

### Derive battle ownership from the archive

`battle_observation` was dropped by migration 0094. Ingest now records
per-battle provenance only through archived observer battle logs
(`packages/ingest/src/battles.mjs`). A battle's participants and its displayed
left side are insufficient evidence of who caused capture.

Parse the archive offline to map canonical battle IDs to observer payloads
using the ingest parser's existing canonical battle identity function.
The shared `canonicalBattleIdentity` in `packages/ingest/src/battles.mjs`
is used by ingest and the private observer scan; do not derive a second identity. Retain battles
supported by legitimate recording evidence and their complete participant,
round, card and deck records, including elite opponents. Reconcile against
the retained observers' historical recording intervals. If a removed
observer's payload is the only surviving evidence for a legitimate battle,
preserve that battle and a sufficient retained replay source before purging
the original payload. Profile, clan and war history require equivalent
provenance and overlap checks; identities still referenced by retained facts
remain as needed.
Many receipts can share the first archived content-addressed payload;
select archive objects from the stored payload identity and actual key, not
by generating a different key from each receipt's fetch date.

### Review the manifest and execute it in bounded operations

Produce a private manifest with subject/reason classification, exact battle
IDs, dependent rows, archive keys and version IDs, counts, byte totals,
overlap kept, unresolved cases and a digest. Report aggregates in the public
notes, never private policies, tags tied to accounts, email records or keys.
Pin the manifest to a cutoff after capture has stopped. Recheck for newly
retained reasons immediately before destructive work. Jamie approves this
concrete manifest before irreversible deletion.

Remove database rows through a named migrate operation, under the production
lease, in short transactions with progress and manifest checks. Respect
foreign-key dependencies: round and card rows, participant rows, dependent
moments, summaries and caches, then battle rows. Rebuild retained rollups
where needed. Delete a deck or identity only when no retained fact references
it. Remove the obsolete ranking tables and enum branches in later contract
migrations after deployed readers and writers have gone. Never alter old
checksummed migrations.

### Remove every replay source

The archive bucket is versioned. A normal object delete leaves a recoverable
version and fails the requirement. Enumerate and delete the manifest's
specific object versions and markers; verify absence with a fresh version
listing. Scope the deletion capability to the approved archive operation,
without granting the internet-facing collector any deletion power.

An archived log may contain battles that stay and battles that go. For a
mixed object, materialize a retained-only payload under a new
content-addressed key, verify it, update its retained replay references, then
purge all versions of the original. Respect the archive's write-once rule;
do not overwrite it in place. Handle cached payload JSON, receipts and replay
state so no remaining entry points at a purged body or reconstructs removed
facts. Retire replay/backfill paths for discarded endpoints too.

Check other reconstructing sources, including historical imports, captured
tool responses, editorial briefs, editor outbox objects and database
backups. Purging S3 payloads alone cannot establish that a database backup
cannot restore old rows. Record the relevant backup expiry or separately
approved deletion; until then report payload purge and backup retirement as
distinct statuses. Keep legitimate sent-mail history and account records
unless a separately settled retention decision removes them.

Finish with bounded vacuum/analyze and measured before/after table sizes,
dead tuples, poll load and archive bytes. Avoid a disruptive table rewrite
solely to make a size counter fall. Reconsider database capacity from the
remaining measured workload, rather than assuming a smaller instance is safe.

## Execution sequence and acceptance

1. **Settle and publish the scope.** Record the purpose in the public docs,
   update conflicting decisions with explicit transition status, and settle
   the recommended cuts. Feature selection asks which recorded person or
   clan benefits and whether the feature needs capture beyond their request.
2. **Stop unwanted growth.** Retire the installed rankings writer, board
   scheduling and season-final backfill; disable automatic elite enrollment;
   transition legitimate personal collection requests, retire Drop's
   automatic enrollment and other dependent callers,
   remove all collection recording reasons and reconcile recordings. Suppress
   editorial composition and pending sends. Guard the admission boundary
   against late leases and replays recreating retired facts. Confirm through
   naturally occurring receipts that no retired fetches or sends recur.
3. **Remove the capability completely.** Remove contracts, registry entries,
   public/global statistics and editorial UI, examples, generated docs,
   caches, rollup jobs, queues and unused infrastructure according to settled
   scope. Personal record views and emails pass fixtures and journeys.
4. **Prepare and approve the purge.** Add the read-only census and manifest
   preview first. Exercise shared battles, former clan members, overlapping
   reasons, stopped legitimate recordings, 2v2, duels, mixed payloads,
   versioned objects, late submissions and interrupted/resumed batches on
   scratch data. Produce exact counts for Jamie before deletion.
5. **Execute and prove the purge.** Use the approved manifest, the lease and
   bounded operations. Verify retained facts and references, absence of
   removable rows and object versions, removed replay routes, and remaining
   backup limits. No destructive operation is used as a live test.
6. **Complete Clan consolidation.** Extract the engine, build the Postgres
   adapter, import and reconcile records, cut over auth/routes/jobs, and
   retire the old runtime. Its import rehearsal can proceed alongside purge
   preparation; its cutover and the purge cannot share a live write window.
7. **Remove maintenance residue.** Update AGENTS and its symlink target,
   engineering rules, reading maps, objective files, installed schedules,
   skills, schema fingerprint, fixture/gym catalogues and public docs. Review
   duplicated Clan objectives for consolidation instead of retaining nine
   owners by accident. Check external consumers before contract removal.

Each runtime change lands by PR after `npm run verify`; CI also builds the
site, runs browser journeys and lints workflows. Removing tool families is
a deliberate contract change: apply MCP domain versioning and independently
check the ordinary-semver JSON API mirrors. Shared removals and Clan cutover
need full acceptance and read-only production read-back. Public tool pages
continue to be generated from the registry.

The retirement is done when there are no autonomous elite/board recordings,
global board history or retired replay sources; no game-wide statistics or
recommendation tools, indirect corpus readers, scoring/prior machinery,
retired aggregates or cached recommendation output remain; no named recording
Collections, independent collection capture reasons or collection quota/API
machinery remain, and retained user tracking, Drop sign-in and integration
profile reads/refreshes work; retained
personal/clan history and mail work; Clan has one session, store and
deployment with Elixir; and the removed capabilities have no running
maintenance owner, hidden schedule, dormant generator or misleading
documentation.

## Initial assessment delivery status

The consistency trace covered the scheduler and admission paths, recording
reasons, board clients and installed Codex schedule, tool/contracts and
rollup readers, mail generation/delivery, public docs/cards, Clan identity,
its state/index layout, policy evaluation, deployment and privacy gates.
It also checked the public API consumers: Drop still needs OAuth and the
JSON API; Discord reads the MCP timeline. Existing credential separation,
the one collector rate budget, policy-pauses-without-a-clan-policy, and
private clan visibility remain constraints through the transition.

The verified consistency findings are removal work, not shipped fixes:
`unrealized` for the new scope in existing runtime surfaces,
`dead-artifact` for the machinery to retire after its consumers leave,
`consumer-drift` for any removed contract still read externally, and
`privacy-promise` for incomplete archive-version or private-state handling.
The plan names their dependencies and acceptance above. Source publication
does not close those findings. Historical migrations and release entries
remain historical records; current runbooks and product promises change
with their implementation phase.

The original `simplify` worktree has pre-existing commits and is behind
origin/main. It was assessed read-only and left untouched. This plan and its
documentation changes are prepared in the separate `elixir-right-sizing`
worktree from origin/main. Another session holds the deployment lease;
this assessment took no lease and made no production writes.

Game-wide meta, recommendations and Collections are confirmed removals. The remaining
product proposals concern autonomous event/tournament capture and the
smaller Clan social/model features. Exact deletion counts
and archive bytes remain work for the census. The plan does not call the
retirement shipped.

Validation for this documentation proposal: `npm run verify` passed,
including formatting, lint, knip, typecheck, the merged site build and all
workspace tests. Production checks were the read-only observations above.
Browser journeys will run in CI; there is no new runtime behavior to accept
or production removal to read back in this proposal.
