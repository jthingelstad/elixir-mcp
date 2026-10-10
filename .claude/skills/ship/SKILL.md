---
name: ship
description: Take a finished Elixir MCP change to production and prove it there. Preflight (your own worktree, AWS caller), release bookkeeping (the contract version file, JSON API version and pin, the What's new file, site docs, the change note), `npm run verify`, commits, a draft pull request merged on a green `validate` check, the deploy (it takes the production lock) with the right acceptance scope, triage of every acceptance failure, the live read-back, then sibling repos and the close. `/ship` runs every step; `/ship from <step>` resumes at one (`/ship from triage` after Jamie ran a deploy the session was refused). Use whenever work in this worktree is ready for production, including at the end of `/tool-change`, `/migration`, a Gym round or a consistency round.
---

# Ship

The loop that takes a finished change to production. It was done by hand
four times on 2026-09-25 (9.0.0 through 9.1.1), and each pass relearned a
step: a deploy time written from memory, a note naming a field its
response does not serve, a catalogue seed pushed past the response cap.

**Deploying is part of done:** a fix that is merged but not deployed is
not shipped. Never stop to ask
whether to deploy. Product questions (a new tool, an MCP or JSON API
major, anything a DECISIONS line covers) are asked before building.

How to change a tool is `/tool-change`, a migration `/migration`, a live
op `/ops`; they end here. Steps, in order: `preflight`, `bookkeeping`,
`verify`, `commit`, `merge`, `deploy`, `triage`, `read-back`, `siblings`, `close`.

## Preflight

1. **The worktree is yours alone.** A session is one worktree, one
   branch, one pull request; the main checkout stays on a clean `main`.
   On Jamie's machine the domain's `scripts/session-start <slug>
   elixir-mcp` makes it. Elsewhere: `git worktree add --detach
   <dir>/elixir-mcp origin/main`, then `scripts/worktree-setup.sh` from it
   with `CODEX_SOURCE_TREE_PATH` (the main checkout) and
   `CODEX_WORKTREE_PATH` set. Edits, commits and pull requests take no
   lock; the deploy takes the production lock itself (Deploy, below).
2. **The caller is cloud-engineer:** `AWS_PROFILE=cloud-engineer aws sts
   get-caller-identity` answers account 999153317627, ARN containing
   `assumed-role/ProjectsCloudEngineer/projects-cloud-engineer`, as
   `infra/scripts/configure-api-throttles.mjs` checks (`deploy.mjs` checks
   no role). Never the `jamie` profile.
3. **origin/main is current:** after `git fetch`, HEAD is not behind
   `origin/main`. Behind means another actor shipped: find out who first.
   Work on the session's branch (`session/<slug>`), made before the
   first edit; main takes nothing but merged PRs. `gh pr list` shows the
   work other sessions already have open.
4. **Nothing holds migrate:** `elixir-mcp-migrate` runs at reserved
   concurrency 1, so a deploy behind a running backfill fails at its
   migration step with a 429 (twice on 2026-09-22). A write through
   `npm run op` holds the production lock while it runs, so `deploy.mjs`
   refuses and names it; a raw invoke does not, so ask before deploying
   over one you know of.
5. **The reference is committed:** `git -C ../cr-agent-api-docs status
   --porcelain -- data/card-roles.json data/deck-aliases.json` is empty.
   The vocabulary import refuses otherwise, after the migrations have run.
6. **Acceptance can run:** `test -f acceptance/.env` (never read it).
   Without it an asked-for gate prints `acceptance: skipped` and runs none.
7. **Nothing blocked is committed:** "never deploy past a commit whose
   infrastructure change is blocked" (ENGINEERING, "Deploying"): deploys
   are cumulative, so the next one would carry it past its refusal.

## Bookkeeping

By what changed. Each record below is a file of the change's own, so
two pull requests never edit one shared file (2026-10-10). Read a shared
file (the JSON API pin, a docs page) before editing it: on 2026-09-08 a
version bump by string replace matched nothing, because another session
had moved the file.

**The MCP contract** (a declaration, response, note or error):
- `npm run contract:bump -- <patch|minor|major>` writes
  `packages/contracts/src/changes/<version>.ts`, the next version after
  the highest on `origin/main`, with a skeleton entry to fill in.
  `CONTRACT_VERSION` is the highest file; nothing else is typed. When
  another pull request takes the number first, run `npm run
  contract:bump` again before rebasing: it renumbers this branch's file
  and the "MCP x.y.z" mentions in the fragments this branch added.
  "Every contract bump updates the changelog" (DECISIONS);
  `elixir_changelog(since)` is how an agent finds what moved, and
  `packages/contracts/test/changelog.test.mjs` refuses a gap or a
  duplicate.
- MCP only, agent-aware: additive is a minor; "a patch is a behaviour
  correction only, and an output-schema change is a patch that moves the
  fingerprint"; "a correction that removes an unreliable field is a patch,
  while a major is for a domain-model change that requires the agent to
  change what its task means" (DECISIONS). A major is Jamie's call.
- Breaking text goes in the entry's `breaking` field, never "Breaking:"
  prose in `summary`: the site renders `breaking` as its own panel and
  `elixir_changelog` serves it as a field. 9.1.0 moved three out.
- `npm run build` in `packages/contracts` afterwards: other workspaces
  read its `dist`, and `services/mcp`'s tests are a bare `node --test`, so
  a focused run reads the old contract (the root `npm test` rebuilds).

**The JSON API** (a tool an operation mirrors changed shape, or `/api/v1`
itself; the operations carry `x-tool` in
`packages/contracts/integration-api.openapi.json`, seven on 2026-09-25):
- `info.version` on ordinary semver: "a removed or renamed response field
  is a major of its own `info.version`" (DECISIONS), an addition a minor.
  A major is Jamie's call.
- A dated entry atop the Versions list in `apps/site/src/docs/integrations.md`.
- The version and fingerprint in `services/web-api/test/integration-api.pin.json`;
  `integration-pin.test.mjs` fails until then, its diff showing the
  fingerprint: 9.0.0 changed a JSON API response as an MCP change and the
  JSON API stayed at 1.3.0.

**What a user sees:** a file in `apps/site/src/_data/updates/`,
`<YYYY-MM-DD>-<NN>-<slug>.md` (`apps/site/AGENTS.md`, "Updates"): a
`# Title` line, then the body written for a person, ending with the versions
("Contracts 9.0.0 and 9.0.1; JSON API 2.0.0."). `/updates` already shows
the changelog entries; this is the story, not a copy.

**Site docs** in `apps/site/src/docs/`, same commit. The tool reference is
generated from the registry: fix the declaration, never the page.

**The change note:** `docs/notes/<YYYY-MM-DD>-<slug>.md`
(`docs/notes/README.md`: what, why, the versions); a decision gets its
`docs/DECISIONS.md` line in the same commit. `docs/NOTES.md` is the frozen
archive; never append to it. Anything left open is a GitHub issue
(`needs-jamie`, `engineering`, `parked`), not a note.

## Verify

`npm run verify`: prettier check, oxlint, knip, the TypeScript check, then
every workspace test on scratch Postgres. It must reach the tests: the
chain is `&&`, and "A run that ends on knip is not a green test run - it
is no test run" (`docs/NOTES.md`, 2026-09-23, when one briefly read as a pass). Read
the test summaries, not the last line.

## Commit

- Logical chunks, message-first: write the message, then stage exactly the
  paths it describes. `git add -A` sweeps another worker's edits into a
  commit whose message does not say so.
- A release commit leads with its version ("9.1.1: the war trophies note
  names the field served; ..."). End every message with the attribution
  trailer the session's instructions require, if any.
- Assert HEAD moved (`git log --oneline -1`). Never pipe commit output
  through `tail`: the pipe's status is tail's, so a failed commit passes.
- `&&`, never `;`, before push or deploy (DECISIONS, "One worktree per run or session; the lock guards production").

## Merge

main accepts only a pull request whose `validate` check is green (the
ruleset on `main`, 2026-09-26; no bypass, for Jamie's account either,
which is the account agents push as). No review is required: the check
is the gate, the PR is the record. The branch need not be up to date
with main (2026-10-08), so auto-merge lands a PR about a minute after
it goes green even when another PR merged first; main's own push run
then tests the combination, and the deploy gate waits for it.

1. At the first push, a draft: `git push -u origin HEAD`, then
   `gh pr create --draft --fill`. The open pull requests are how sessions
   see each other, so it goes up early, not at the end.
2. Done and `npm run verify` passed: push, `gh pr ready`, then
   `gh pr merge --auto --rebase --delete-branch` (a multi-commit PR gets
   a title that says what the whole ships). Rebase keeps each
   message-first commit on main as its own commit.
3. `gh pr checks --watch --fail-fast`. Green: auto-merge lands it;
   never merge by hand while it does. Red:
   read the failure, fix on the branch, push; never merge around it. A
   check that fails and passes on a re-run is a flake, and a flake is a
   defect: fix it in this PR or file an `engineering` issue the same day.
4. A rebase conflict with main (GitHub reports the PR `DIRTY`): rebase
   the branch on `origin/main`, resolve, push; the check re-runs. A
   contract version file that collides is renumbered with `npm run
   contract:bump` first.
5. `gh pr view --json state -q .state` is `MERGED`, then
   `git fetch origin && git switch --detach origin/main` in the
   session's worktree. Deploy from there, never from a branch.

Work that stops before the merge (credentials, a red check you cannot
fix now) leaves the PR open with its state in the PR body. Ending a
session (`session-finish`) refuses work that is on no pull request.

## Deploy

```sh
AWS_PROFILE=cloud-engineer node infra/scripts/deploy.mjs --acceptance=<family>
```

`deploy.mjs` takes the production lock after the CI gate and releases it
when it exits (`infra/scripts/lib/production-lock.mjs`; one file in the
clone's common git directory, so every worktree sees it). A lock another
holder has is a wait, never a workaround: the refusal names the holder,
since when and what for, and their deploy ships origin/main, so yours may
find nothing left to do. Never clear another holder's lock. A live deploy
writes `deploys/production.json` and comments on each pull request it
shipped (the time, the versions, the acceptance result).

The profile goes in the environment: "the CLI profile flag alone does not
satisfy the SDK's provider chain" (ENGINEERING). The only flags
(`infra/scripts/lib/deploy-args.mjs`):

| flag | use |
|---|---|
| (none) | update the stack; acceptance skipped, with a WARNING |
| `--acceptance=<family>` | that family's cases; `a,b` for several |
| `--acceptance` (or `ACCEPTANCE=1`) | the whole suite |
| `--skip-web` | no site build or sync |
| `--rotate-origin-secret` | mint a new CloudFront origin secret; the doors accept the old one (`OriginSecretPrevious`) until it is cleared |
| `--verify-reference-seed` | update only: after operator code push, compare every live reference seed column before migrations/import; require identical seed content and import the same frozen repository snapshot |
| `--platform` | migrations and the stack update even in the site lane |
| `--param=Key=Value` | a PRESERVED parameter's first value |
| `--help`, `-h` | print the flags; deploys nothing |
| `--create` | first deploy only; GATED, never from here |

**Scope.** "The acceptance suite is the release gate, opted into per
deploy" (DECISIONS). A tool changed: `--acceptance=<family>`, the tool
name's prefix (`badges`, `battles`, `cards`, `clans`,
`elixir`, `game`, `players`, `war`); 9.0.1 ran
`--acceptance=war,clans`. Shared code (`services/mcp/src/protocol.mjs`,
`packages/tools`, ingest) or a release: `--acceptance`;
family runs skip the `#docs` cases. Nothing a tool serves changed
(console, site copy, infrastructure, mail, an op): none, and the change
note says why. Never the whole suite by habit: about four and a half minutes of
heavy reads, and on 2026-09-23 a full pass on every deploy drained the
database's EBS byte balance in an afternoon. `--skip-web` leaves `/docs`,
`/updates` and `/tools.json` as they were: never with a contract or docs
change.

**Refusals.** A dirty worktree (untracked files aside): the build bundles
the tree as it is, so an uncommitted edit would ship untraced. An unknown
flag exits 2 before any AWS call: until 2026-09-25, `--help` deployed.
**The CI gate** (`infra/scripts/lib/ci-gate.mjs`): HEAD must be
`origin/main`, and `validate` must be green on HEAD or on the merged PR
head with the same tree; a check still running is waited for (15 min).
`--break-glass` skips it only when GitHub itself is unreachable, never
for a red check, and the pull request says why.

**Lanes** (`infra/scripts/lib/deploy-lane.mjs`). Each bundle's key is
the hash of its content. When every key and the template match the live
stack (and no `--param` or rotation), the deploy takes the **site
lane**: no migrate push, no migrations, no stack update; everything else
below still runs. The log names the lane and, for the platform lane,
what changed. A docs page is always platform: the corpus rides four
bundles.

**Order:** build, upload, lane, migrations (a failure stops the deploy before
code flips), vocabulary import, stack, site publish (assets first,
never deleted; then documents; `lib/site-publish.mjs`), CloudFront
invalidation and the prune of assets unshipped for 14 days, smoke (`infra/scripts/smoke.mjs`), acceptance when asked. A
red smoke or acceptance means the code is already live: "a red smoke means
fix forward now, not walk away". Migrations never roll back.

**The snapshot.** The import rewrites `fixtures/card-roles.snapshot.json`,
the tests' copy of the vocabulary. If it moved, commit it on a branch and
merge it (it is a PR like any other) ("fixtures:
card-roles snapshot at the reference's <sha>", as f9b5efa5), or refresh it
first with `node infra/scripts/import-card-roles.mjs --snapshot-only`.

**Refused by the session's permission check?** Do not route around it,
piece by piece or through a sibling's CI. Hand Jamie the exact command
once, acceptance flag included, and say "deploy owed" on the pull
request (the 2026-09-25 13:06Z blocked run, closed by the 9.0.1 deploy on
Jamie's go). `/ship from triage` once it has run.

## Triage

Every acceptance failure gets one verdict, and the report to Jamie lists them all. The
verdicts, the file each writes and its precedent are in `triage.md` beside
this file. Without exception:
- a suspected flake is re-run alone (`node acceptance/run.mjs --only
  <suite/id>`) before it is called one;
- a `known.json` entry has a current reason and an `until`; a failure you
  can fix is never known;
- a `result_too_large` at the 48,000-character cap is a priced answer, so
  a catalogue seed that trips it is re-seeded smaller;
- no control case is deleted: every finding keeps one.

## Read-back

The smoke read the doors; read what this change moved, reads only:
- `curl -s https://elixir.poapkings.com/api/public/status`: `health.ok` is
  true (edge-cached about 60 s).
- On Jamie's `elixir-mcp` connection, `elixir_changelog` with `since` the
  previous version answers the new entry, and `meta.contract_version` on
  any response is live. `serverInfo.version` (`<contract>+tools.<fingerprint>`)
  shows on reconnect (`/mcp`), which a new argument may need first.
- The change itself: re-make the call that showed the defect (the Gym
  case's arguments, the feedback item's call) and read the changed field.
- On the same host, `/tools.json` carries `contract_version` and
  `/docs/integration-api.json` the JSON API's `info.version`; `/updates`
  lists the update and `/updates/<date>-contract-<x-y-z>/`.

## Siblings

- Only after the hub change it needs is live: Drop's sign-in over
  `/api/v1` (cffc06d) went out after 9.1.1 let `/oauth/userinfo` answer an
  `/api/v1` grant, Clan b4a5d61 after 9.0.1.
- Drop, poapkings.com, cr-agent-api-docs and elixir-mcp-discord
  take only pull requests from 2026-09-26, on this repo's ruleset shape
  (`validate`, rebase, no bypass): each lands through its own Merge step.
- Elixir Drop deploys by CI from `main` once
  `validate` is green on the merged commit (moving to GitHub OIDC roles),
  so merging one is a production deploy: a session that could not deploy
  the hub does not merge a sibling that needs it. Watch the deploy on the
  merge SHA (`gh pr view <n> --json mergeCommit`), not the branch's:
  `gh run list -c <sha>`, then `gh run watch <id> --exit-status`.
- elixir-mcp-discord's three bots build from the local checkout on
  purpose (nearly live code: they are Jamie's tests); its own guide
  owns their deploy.
- Clan is part of this application: its shared packages, UI, private ledger and
  jobs build, test and deploy in the canonical Elixir lane.
- elixir-bot is retired (stopped 2026-09-26): no sibling step, never in
  scope.
- Each sibling repo keeps its own gate (Drop's `CONTRIBUTING.md` names
  it). A sibling change is made in that repo's own worktree, named when
  the session starts (`session-start <slug> elixir-mcp <sibling>` on
  Jamie's machine). Collectors: `docs/RELEASING-COLLECTOR.md`.

## Close

- The deploy's comment on each pull request it shipped is the record of
  what went live; there is no post-deploy notes PR. What is still owed is
  an issue (`needs-jamie` or `engineering`). A deploy time quoted anywhere
  only if you read it: on 2026-09-25 an unverified one had to come out
  (dd546ed4). Write it `13:14Z (8:14 AM CT)`.
- Answer the feedback the change closes after the read-back, `done` naming
  the version, by `docs/OPERATIONS.md`, "Feedback" (through `npm run op`,
  a compare-and-set, then a read-back).
- A DECISIONS line added or changed: `/consistency <decision>` that day.
- `git status --porcelain` empty (untracked files count), then end the
  session (`session-finish <slug>` on Jamie's machine).
- Tell Jamie what shipped (versions, commits), what acceptance caught, and
  **Needs you** (a refused deploy's command, a live check only he can
  make). Times in US Central.
