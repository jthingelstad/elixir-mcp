# 2026-11-14 — The production lock holds a batch, and a throttle is waited out

No MCP tool, `/api/v1` operation, contract version, migration or stored
data changes. Deploy and operations tooling only; nothing was run
against production to make it.

## A throttle is waited out (#456)

`elixir-mcp-migrate` and `elixir-mcp-jobs` run at reserved concurrency
1, so an invoke that meets another invocation is refused with
TooManyRequestsException before the function runs. A read that began
before the deploy took the lock, a scheduled jobs run or a raw read could
fail the deploy's migrate step that way. `lib/lambda-throttle.mjs` sends
a throttled invoke again with doubling backoff (2 s, capped at 30 s) for
at most the function's own timeout and half a minute; nothing but a
throttle is ever resent, since only a throttle is known not to have run.
The deploy's migrate and public-statistics invokes and `npm run op` use
it. An op read stops waiting the moment the lock is taken (exit 3), and
an op whose function stays busy exits 4.

Chosen over a shared read lock: the invocation in the way is often not
one that goes through the lock at all (a scheduled run, a raw `aws
lambda invoke`), and reader counts that survive a crashed reader are
more machinery than the problem. Backoff covers every source.

## A batch holds the lock (#440)

`npm run op:batch -- --purpose "<text>" -- <command>`
(`infra/scripts/op-batch.mjs`, `holdForBatch` in `lib/production-lock.mjs`)
takes the lock once as holder `batch`, runs the command with the lock's
id in `ELIXIR_PRODUCTION_LOCK_ID`, and releases it when the command
ends. `npm run op` inside finds that live lock and runs under it, so a
multi-step backfill with `after` cursors is one hold. A signal goes to
the command and the lock is released only once it has stopped; a lock
held by someone else exits 3 naming them. `docs/OPERATIONS.md`
("Batches") has the commands. The issue's other half, locking
`series-backfill.mjs`, went with the series retirement (migration 0256):
that script no longer exists.

## Platform review leftovers (#645)

- `node acceptance/run.mjs --help` prints the usage and exits; an
  unknown flag is refused instead of ignored (it used to start the whole
  suite).
- The deploy's prune also deletes `deploys/site-assets/` manifests older
  than the 14-day window, beyond the newest 30. No prune reads those
  again; `deploys/site-published.json` is outside the prefix.

## The workflow lint is this repository's own (#447)

`infra/scripts/test-workflows.sh` is rewritten for this repository's
rules: SHA-pinned actions, `permissions: {}` and per-job permissions,
`persist-credentials: false` on each checkout step (checked per step,
not by count), no `pull_request_target`, and `validate.yml`'s `validate`
job named `validate`, run `if: always()`, needing every other job. An
awk check that cannot run is a failure, never a pass.
`services/mcp/test/test-workflows.test.mjs` proves each rule still fails
on a violation.

## Worktrees get their siblings (#457)

`scripts/worktree-setup.sh` runs `scripts/link-siblings.sh`, which links
each git repository beside the main checkout that the worktree's parent
lacks, so a Codex-made worktree reaches `../cr-agent-api-docs` and
`../drop.poapkings.com`. It never replaces an existing entry and does
nothing for a worktree beside the main checkout.

## After review (Codex on #1044)

- A throttled op read asks about the lock again after each wait, right
  before the resend, so a deploy that takes the lock mid-wait is never
  met by a read sent under it.
- A batch's command runs in a process group of its own; a signal goes to
  the whole group and the lock is released only once the group is empty.
  Before, a shell killed by SIGTERM released the lock while the op it had
  started was still running.
