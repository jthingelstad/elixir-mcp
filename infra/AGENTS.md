# infra: the stack and the deploy

One CloudFormation stack (`template.yaml`) in `us-east-1`, profile
`cloud-engineer`. Three HTTP Web Functions (collector, mcp, web-api), five Event Functions
(email-relay, jobs, migrate, scheduler, timeline-sync), RDS PostgreSQL `db.t4g.micro` in a NAT-free
VPC, S3 (payload archive, outbox, web), CloudFront in front of one origin.
`docs/ENGINEERING.md` has the invariants; the `ship` skill has the loop.

## The stack

- **Parameters:** every one is classed in `scripts/parameters.mjs`
  (REQUIRED, PRESERVED, SECRET). CloudFormation resets an omitted
  parameter to its default, so an unclassed one is a production bug;
  `services/mcp/test/infra-controls.test.mjs` holds the classing to the
  template.
- **Network:** VPC Lambdas never call another Lambda. They hand work to the
  non-VPC email relay by writing one object to the outbox bucket (`email/`,
  `clan-model/`, `clan-discord/`, `timeline-discord/`) through the S3
  gateway endpoint; S3 notifies SQS, which holds retries and the
  dead-letter queue. The timeline's Discord lines have a queue of their own
  (batch 1), so a busy channel never delays sign-in mail. A collector
  admission wakes the timeline sync the same way (`timeline-sync/`), and
  the relay's receipts for the Discord quality ledger come back to it on
  `discord-receipt/`. Raw editor runs are `discord-runs/` in the archive
  bucket, expired at 30 days by its lifecycle.
- **Read budgets:** each function's `statement_timeout` (PGOPTIONS) sits
  just under its Lambda timeout. Migrate, jobs and scheduler run at
  reserved concurrency 1, so never run a backfill and a deploy together.
- **Alarms** publish to SNS `elixir-mcp-alarms` for the sysadmin
  `projects-ops-alerts` queue, never email. A custom metric exists only to
  back an alarm. The `elixir-mcp` dashboard (`OpsDashboard`) reads only
  standard AWS metrics, those alarm-backed metrics and Logs Insights; keep
  it at 50 metrics or fewer (the account's free tier is three dashboards
  of 50).
- **IAM** ships with the stack through a deploy. An IAM change outside a
  deploy is Jamie's to approve, and a deploy never carries an access change
  Jamie has blocked: deploys are cumulative.
- **Secrets** are referenced by name; values are Jamie's, set in the
  console (`docs/SECRETS.md`). Never read one.
- **DNS** is at Namecheap; Jamie applies records by hand.

## Deploying

`AWS_PROFILE=cloud-engineer node infra/scripts/deploy.mjs`, from the repo root on a clean, green
`origin/main` (the CI gate refuses anything else; `--break-glass` only when
GitHub is down). `--help` lists every flag. The deploy is `DEPLOY_PHASES`
in `deploy.mjs`, an ordered list of named phases, each with the condition
it runs on; `services/mcp/test/infra-controls.test.mjs` asserts the list
and each lane's sequence directly. Order: worktree, CI gate, lock,
account, build, upload, the app's assets, lane, the endpoint grant check,
migrate, vocabulary import, stack, the endpoint grant, web (card art,
site, invalidation, prune), smoke, then acceptance when asked
(`--acceptance` or `--acceptance=<family>`), and the record.

- **Lanes:** bundles are named by content, so a change that touches no
  Lambda and not the template takes the site lane and skips migrations and
  the stack (`scripts/lib/deploy-lane.mjs`; `--platform` overrides). Nothing
  a Lambda carries may read the clock at build time. Each native door has
  its own build fingerprint; a one-door code change keeps the other
  revisions unchanged, while shared configuration still updates its users.
- **Vocabulary:** the import reads `../cr-agent-api-docs` and refuses an
  uncommitted `data/card-roles.json` or `data/deck-aliases.json`; it also
  refreshes `fixtures/card-roles.snapshot.json`, which is committed with the
  change. `--verify-reference-seed` compares the live reference tables with
  the seed before anything is written and stops on a mismatch.
- **Origin secret:** `--rotate-origin-secret` mints a new one; the doors
  keep the old one as `OriginSecretPrevious` until it is cleared.
- **The production lock:** `deploy.mjs` takes it after the CI gate and
  holds it for the whole run (`scripts/lib/production-lock.mjs`, one
  holder, in the clone's common git directory, so every worktree sees
  it); `npm run op` (`scripts/op.mjs`) takes it for an ops-lambda write,
  and a read waits while it is held. A held lock prints who, since when
  and doing what, and exits 3 from `npm run op`: wait, never clear it. A
  lock whose process has exited on this host is released automatically.
- **Endpoint grants:** the CloudFront grant on each Web Function endpoint
  is written by the deploy, outside CloudFormation. Before anything is
  migrated or switched, a read-only check (`grants-check`,
  `scripts/lib/web-release.mjs`) refuses the deploy when a live door's
  policy is missing or not the deploy's own; restoring one is an access
  change outside a deploy, Jamie's to approve. After the stack update the
  deploy writes any missing grant and reads every one back.
- **Site publish:** the site phase builds only the static site
  (`build-site.mjs --prebuilt`; the build phase built the rest) and
  uploads only what changed: each file's MD5 against the object's ETag,
  and its Content-Type and Cache-Control against the last publish's record
  (`deploys/site-published.json` in the code bucket, HEAD where the record
  is silent), 16 at a time (`scripts/lib/site-publish.mjs`). A new kind
  of file needs its type in `CONTENT_TYPES`; the site build refuses one
  without. Each deploy writes the `assets/` keys it ships to
  `deploys/site-assets/`, and the prune takes only an asset no deploy in
  the last 14 days shipped and none uploaded; any manifest it cannot read
  stops the prune, never the deploy. A document S3 keeps on delete fails
  the publish; an asset it keeps is a warning.
- **The deploy record:** every deploy writes `deploys/production.json` to
  the code bucket and comments on each pull request it shipped, with the
  time, the versions, the acceptance result and the timing: when it
  started (before the CI gate), how long the gate waited
  (`gate_wait_seconds`, null on `--break-glass`) and each phase's seconds
  (`phases`).

## Scripts

`scripts/` also holds `cr-api.mjs` (`npm run cr`, a direct CR call to check
a claim), `name-collector-release.mjs` (`docs/RELEASING-COLLECTOR.md`),
`editor-replay.mjs` (`npm run editor-replay`, a clan model's raw run
through today's editor on a maintainer's own key; the `discord-review`
skill), `build-site.mjs`, `smoke.mjs` (the smoke phase; its checks are
`runSmoke`, tested offline in `services/mcp/test/smoke.test.mjs`),
`test-workflows.sh` (the
workflow lint), `test.mjs` (`npm test`: every workspace test, one build
then a bounded pool locally, `--shard i/n` in CI), `e2e-shard.mjs` (the
spec files one CI journey shard runs) and `e2e-needed.sh` (whether a
change needs the journeys; `lib/e2e-inputs.mjs` is its test's measure of
what the specs read).
