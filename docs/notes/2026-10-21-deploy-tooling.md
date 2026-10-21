# 2026-10-21 — The deploy is a phase list, timed, with a grant check

Plan §5 of the 2026-10-21 platform review (`clash-royale/plans/elixir-platform-review-2026-10-21.md`),
approved by Jamie: "Approved to move forward with the entire plan."

- **A phase list.** `infra/scripts/deploy.mjs` was 838 lines of top-level
  code; its step order was tested by `source.indexOf` offsets in four
  tests (infra-controls, deploy-record, reference-seed-preview). It is now
  `DEPLOY_PHASES`, an exported ordered list of named phases, each with the
  condition it runs on (`when`), run by `runPhases` against one state
  object; `deploy(argv)` refuses its arguments before the first phase
  (`argumentRefusal`, `lib/deploy-args.mjs`) and returns the exit code. The
  tests now run the real list with each phase's work replaced by a
  recorder and assert the exact sequence of each lane (site, platform,
  `--create`, `--skip-web`), that a refusal stops every later phase, and
  that the lock follows the CI gate with no condition. The steps, their
  messages and their exit codes are unchanged.
- **Timing in the record.** The deploy's start is taken before the CI
  gate, and each phase's seconds as it ends. `deploys/production.json` and
  its history copy gain `started_at`, `gate_wait_seconds` (null on
  `--break-glass`), `seconds` (start to record) and `phases`
  (`[{ phase, seconds }]`); each PR comment gains a timing line naming
  every phase of a second or more (`lib/deploy-record.mjs`). Until now
  only the deploy's end was recorded, so the gate's wait and a slow phase
  could only be measured by hand.
- **Endpoint grant check.** The CloudFront grant on each Web Function
  endpoint is written by the deploy, outside CloudFormation, so nothing
  else notices it drift. A new read-only phase, `grants-check`, reads each
  live door's resource policy before anything is migrated or switched and
  refuses the deploy (exit 2, each door named) when one is missing or is
  not exactly `endpointPolicy` for that endpoint and the stack's
  distribution (`checkWebEndpointGrants`, `lib/web-release.mjs`). A door
  the live stack does not have yet is skipped. The grant after the stack
  update, which writes a missing policy and reads every one back, is
  unchanged. A behaviour change worth knowing: a grant removed by hand now
  stops the next deploy instead of being silently rewritten after the
  switch; restoring it is an access change outside a deploy, Jamie's to
  approve.
- **Invalidation.** The invalidation names the stack's own
  `SiteDistributionId` output instead of listing the account's
  distributions and matching the comment `elixir.poapkings.com`. The same
  distribution (`E1KBSTIXY6Q5OS`, read 2026-10-21); one call fewer, and a
  comment edit can no longer silently skip the flush.
- **Smoke tests.** `infra/scripts/smoke.mjs` is now `runSmoke`, with the
  stack, `fetch`, `sleep` and the log injected and the script's own run
  behind a main guard. `services/mcp/test/smoke.test.mjs` drives it against
  a fake origin: a healthy one passes all 44 checks, and each regression a
  check was written for (a rolled-back stack, `/mcp` without a bearer, the
  edge's error mapping turning API refusals into the shell, llms.txt with
  no charset, the consent page's CSP overwritten, a third-party script on
  the app shell, a cache that never hits) fails that check by name. The
  edge-cache check's six bounded retries are pinned too.

No MCP, JSON API or schema change. The site phase's duplicated build and
uploads (the other half of plan §5) follow in their own pull request,
measured against this one's recorded phases.
