---
name: ship
description: Take a finished Elixir MCP change to production and prove it there. Preflight (checkout lease, AWS caller), release bookkeeping (MCP contract and changelog, JSON API version and pin, What's new, site docs, NOTES), `npm run verify`, commits and push, the deploy with the right acceptance scope, triage of every acceptance failure, the live read-back, then sibling repos and the close. `/ship` runs every step; `/ship from <step>` resumes at one (`/ship from triage` after Jamie ran a deploy the session was refused). Use whenever work in this checkout is ready for production, including at the end of `/tool-change`, `/migration`, a Gym round or a consistency round.
---

# Ship

The loop that takes a finished change to production. It was done by hand
four times on 2026-09-25 (9.0.0 through 9.1.1), and each pass relearned a
step: a deploy time written from memory, a note naming a field its
response does not serve, a catalogue seed pushed past the response cap.

**Deploying is part of done:** "a fix that is committed but not deployed
is not shipped" (`AGENT-TEAM/run-elixir-mcp.md`). Never stop to ask
whether to deploy. Product questions (a new tool, an MCP or JSON API
major, anything a DECISIONS line covers) are asked before building.

How to change a tool is `/tool-change`, a migration `/migration`, a live
op `/ops`; they end here. Steps, in order: `preflight`, `bookkeeping`,
`verify`, `commit`, `deploy`, `triage`, `read-back`, `siblings`, `close`.

## Preflight

1. **The lease is yours:** `node AGENT-TEAM/scripts/objective-lease.mjs
   check <objective> --lease-id <id>` before the first commit and before
   push; with none, claim one (`session` interactively). A lease another
   actor holds is a stop, not a wait.
2. **The caller is cloud-engineer:** `AWS_PROFILE=cloud-engineer aws sts
   get-caller-identity` answers account 999153317627, ARN containing
   `assumed-role/ProjectsCloudEngineer/projects-cloud-engineer`, as
   `infra/scripts/configure-api-throttles.mjs` checks (`deploy.mjs` checks
   no role). Never the `jamie` profile.
3. **main is current:** after `git fetch`, `git status -sb` is not behind
   `origin/main`. Behind means another actor shipped: find out who first.
4. **Nothing holds migrate:** `elixir-mcp-migrate` runs at reserved
   concurrency 1, so a deploy behind a running backfill fails at its
   migration step with a 429 (twice on 2026-09-22, `run-elixir-mcp.md`).
   Read NOTES for a batch that says it is running.
5. **The reference is committed:** `git -C ../cr-agent-api-docs status
   --porcelain -- data/card-roles.json data/deck-aliases.json` is empty.
   The vocabulary import refuses otherwise, after the migrations have run.
6. **Acceptance can run:** `test -f acceptance/.env` (never read it).
   Without it an asked-for gate prints `acceptance: skipped` and runs none.
7. **Nothing blocked is committed:** "never deploy past a commit whose
   infrastructure change is blocked" (ENGINEERING, "Deploying"): deploys
   are cumulative, so the next one would carry it past its refusal.

## Bookkeeping

By what changed. Read each file before editing it: on 2026-09-08 a version
bump by string replace matched nothing, because another session had moved
the file, and an entry shipped under a version that already existed
(`packages/contracts/test/changelog.test.mjs`).

**The MCP contract** (a declaration, response, note or error):
- `CONTRACT_VERSION` in `packages/contracts/src/version.ts` and a new first
  `CHANGELOG` entry in `src/changelog.ts`, one commit: "every contract bump
  updates the changelog" (DECISIONS); `elixir_changelog(since)` is how an
  agent finds what moved.
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

**What a user sees:** an entry atop `apps/site/src/_data/updates.js`
(`date`, `title`, `body`) written for a person, ending with the versions
("Contracts 9.0.0 and 9.0.1; JSON API 2.0.0."). `/updates` already shows
the changelog entries; this is the story, not a copy.

**Site docs** in `apps/site/src/docs/`, same commit. The tool reference is
generated from the registry: fix the declaration, never the page.

**NOTES:** a dated entry at the end of `docs/NOTES.md` (what, why, the
versions); a decision gets its `docs/DECISIONS.md` line in the same commit.

## Verify

`npm run verify`: prettier check, oxlint, knip, the TypeScript check, then
every workspace test on scratch Postgres. It must reach the tests: the
chain is `&&`, and "A run that ends on knip is not a green test run - it
is no test run" (NOTES, 2026-09-23, when one briefly read as a pass). Read
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
- `&&`, never `;`, before push or deploy (DECISIONS, "Lease first"). Check
  the lease, `git push origin main`; CI's `validate.yml` reruns the gate.

## Deploy

```sh
AWS_PROFILE=cloud-engineer node infra/scripts/deploy.mjs --acceptance=<family>
```

The profile goes in the environment: "the CLI profile flag alone does not
satisfy the SDK's provider chain" (ENGINEERING). The only flags
(`infra/scripts/lib/deploy-args.mjs`):

| flag | use |
|---|---|
| (none) | update the stack; acceptance skipped, with a WARNING |
| `--acceptance=<family>` | that family's cases; `a,b` for several |
| `--acceptance` (or `ACCEPTANCE=1`) | the whole suite |
| `--skip-web` | no site build or sync |
| `--param=Key=Value` | a PRESERVED parameter's first value |
| `--help`, `-h` | print the flags; deploys nothing |
| `--create` | first deploy only; GATED, never from here |

**Scope.** "The acceptance suite is the release gate, opted into per
deploy" (DECISIONS). A tool changed: `--acceptance=<family>`, the tool
name's prefix (`badges`, `battles`, `cards`, `clans`, `collections`,
`elixir`, `game`, `players`, `rankings`, `war`); 9.0.1 ran
`--acceptance=war,clans`. Shared code (`services/mcp/src/protocol.mjs`,
`tools.mjs`, `tools/shared.mjs`, ingest) or a release: `--acceptance`;
family runs skip the `#docs` cases. Nothing a tool serves changed
(console, site copy, infrastructure, mail, an op): none, and NOTES says
why. Never the whole suite by habit: about four and a half minutes of
heavy reads, and on 2026-09-23 a full pass on every deploy drained the
database's EBS byte balance in an afternoon. `--skip-web` leaves `/docs`,
`/updates` and `/tools.json` as they were: never with a contract or docs
change.

**Refusals.** A dirty worktree (untracked files aside): the build bundles
the tree as it is, so an uncommitted edit would ship untraced. An unknown
flag exits 2 before any AWS call: until 2026-09-25, `--help` deployed.

**Order:** build, upload, migrations (a failure stops the deploy before
code flips), vocabulary import, stack, site sync and CloudFront
invalidation, smoke (`infra/scripts/smoke.mjs`), acceptance when asked. A
red smoke or acceptance means the code is already live: "a red smoke means
fix forward now, not walk away" (WORKFLOW.md). Migrations never roll back.

**The snapshot.** The import rewrites `fixtures/card-roles.snapshot.json`,
the tests' copy of the vocabulary. If it moved, commit it ("fixtures:
card-roles snapshot at the reference's <sha>", as f9b5efa5), or refresh it
first with `node infra/scripts/import-card-roles.mjs --snapshot-only`.

**Refused by the session's permission check?** Do not route around it,
piece by piece or through a sibling's CI. Hand Jamie the exact command
once, acceptance flag included, and write "deploy owed" into NOTES (the
2026-09-25 13:06Z blocked-run note, closed by the 9.0.1 deploy on Jamie's
go). `/ship from triage` once it has run.

## Triage

Every acceptance failure gets one verdict, and NOTES lists them all. The
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
- Elixir Clan (`validate`, then `deploy`) and Elixir Drop (`Validate Main`,
  then `Build and Deploy`) deploy by CI on push to `main`, the second run
  started by `workflow_run` once the first is green: `gh run list -w
  <workflow> -c <sha> -L 1`, then `gh run watch <id> --exit-status`. That
  push is a production deploy, so a session that could not deploy the hub
  does not push a sibling that needs it.
- A kit change (`packages/design`, `ui`, `client`) reaches Clan when the
  `elixir-mcp` pin in its `apps/web/package.json` moves to the pushed commit.
- elixir-bot commits straight to `main` and reads MCP unpinned, "reading a
  missing field as unavailable, never 0" (DECISIONS).
- Each repo keeps its own lease tool, objectives and gate (Clan `npm run
  verify`, Drop the one its `CONTRIBUTING.md` names, elixir-bot
  `scripts/gates.sh`); leases in directory-alphabetical order, released in
  reverse (`../AGENT-TEAM/WORKFLOW.md`). Collectors: `docs/RELEASING-COLLECTOR.md`.

## Close

- Finish the NOTES entry: commit deployed, versions live, migrations run,
  acceptance scope and counts with every verdict, what is owed. A deploy
  time only if you read it: on 2026-09-25 an unverified one had to come
  out (dd546ed4). Write it `13:14Z (8:14 AM CT)`.
- Answer the feedback the change closes after the read-back, `done` naming
  the version, by `AGENT-TEAM/close-the-loop.md`'s write rules.
- A DECISIONS line added or changed: `/consistency <decision>` that day.
- `git status --porcelain` empty (untracked files count), then
  `objective-lease.mjs release <objective> --lease-id <id>`.
- Tell Jamie what shipped (versions, commits), what acceptance caught, and
  **Needs you** (a refused deploy's command, a live check only he can
  make). Times in US Central.
