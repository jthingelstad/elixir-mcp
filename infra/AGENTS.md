# infra: the stack and the deploy

One CloudFormation stack (`template.yaml`) in `us-east-1`, profile
`cloud-engineer`. Seven Lambdas (collector, email-relay, jobs, mcp,
migrate, scheduler, web-api), RDS PostgreSQL `db.t4g.micro` in a NAT-free
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
  `clan-model/`) through the S3 gateway endpoint; S3 notifies SQS, which
  holds retries and the dead-letter queue.
- **Read budgets:** each function's `statement_timeout` (PGOPTIONS) sits
  just under its Lambda timeout. Migrate, jobs and scheduler run at
  reserved concurrency 1, so never run a backfill and a deploy together.
- **Alarms** publish to SNS `elixir-mcp-alarms` for the sysadmin
  `projects-ops-alerts` queue, never email. A custom metric exists only to
  back an alarm; there is no dashboard.
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
- Claim the lease first (`node AGENT-TEAM/scripts/objective-lease.mjs claim
  session`) and release it after the live read-back.

## Scripts

`scripts/` also holds `cr-api.mjs` (`npm run cr`, a direct CR call to check
a claim), `name-collector-release.mjs` (`docs/RELEASING-COLLECTOR.md`),
`build-site.mjs`, `smoke.mjs` and `test-workflows.sh` (the workflow lint).
