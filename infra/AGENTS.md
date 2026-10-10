# infra: the stack and the deploy

One CloudFormation stack (`template.yaml`) in `us-east-1`, profile
`cloud-engineer`. Eight Lambdas (collector, email-relay, jobs, mcp,
migrate, scheduler, timeline-sync, web-api), RDS PostgreSQL `db.t4g.micro` in a NAT-free
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
  admission wakes the timeline sync the same way (`timeline-sync/`).
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
GitHub is down). `--help` lists every flag. Order: build, upload, lane,
migrate, vocabulary import, stack, web sync, smoke, then acceptance when
asked (`--acceptance` or `--acceptance=<family>`).

- **Lanes:** bundles are named by content, so a change that touches no
  Lambda and not the template takes the site lane and skips migrations and
  the stack (`scripts/lib/deploy-lane.mjs`; `--platform` overrides). Nothing
  a Lambda carries may read the clock at build time.
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
- **The deploy record:** every deploy writes `deploys/production.json` to
  the code bucket and comments on each pull request it shipped, with the
  time, the versions and the acceptance result.

## Scripts

`scripts/` also holds `cr-api.mjs` (`npm run cr`, a direct CR call to check
a claim), `name-collector-release.mjs` (`docs/RELEASING-COLLECTOR.md`),
`build-site.mjs`, `smoke.mjs` and `test-workflows.sh` (the workflow lint).
