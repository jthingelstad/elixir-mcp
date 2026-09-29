# Run Elixir Clan

Own the outcome: **the product is up, deployed from `main`, cheap, and
still speaking Elixir's current contract.** One Lambda, one table, one
distribution, one dependency that matters. Most of what can go wrong here
is a deploy that did not land, an Elixir change this product did not
follow, or a sign-in that no longer comes back to where Clan is served.

## Every run

- **Alive.** `GET https://elixir.poapkings.com/api/clan/health` is
  `{ ok: true }`; the app shell serves at `/clan/`; `/api/clan/me` signed
  out is a 401 JSON. The smoke
  script's reads (`node infra/scripts/smoke.mjs`) are the checklist; run
  them, do not re-derive them.
- **Deployed.** `gh run list --limit 5`: the latest `validate` and
  `deploy` on `main` are green and the deployed commit is `origin/main`.
  No PR of this repo's has sat open with a green check and auto-merge off
  without a reason in a run report or an issue.
  A red deploy is this objective's to fix in the run. A green deploy whose
  smoke failed after the AppUrl flip was the first day's lesson: read the
  smoke output, not just the status.
- **Alarms.** `elixir-clan-api-errors`, `elixir-clan-api-5xx`,
  `elixir-clan-slow-requests` state and history (`aws cloudwatch describe-alarms
  --profile cloud-engineer`). An alarm the Operator saw is one this objective
  explains: read the Lambda log group for the window, name the cause.
- **Cost.** The stack's estimated charges stay near zero; the reserved
  concurrency of 10 and the 30-day log retention are the ceilings. Clan is
  a first-party client, so its reads spend no one's Elixir quota (Jamie,
  2026-09-23); a change that polls or loops is still a defect whatever it
  costs here.
- **Elixir's contract.** Compare the contract version Elixir answers
  (`initialize` result, or the `elixir_changelog` tool) with the version
  `AGENTS.md` §Elixir tools this app depends on names. A minor bump with a
  changed shape of `clans_participation`, `clans_roster` or
  `elixir_my_players` is a gap: read the changelog entry, adapt, test, ship.
  The kit comes from the workspace (2026-09-28), so a design change
  reaches Clan in the pull request that makes it; never copy a file.
- **The OAuth client.** Clan's is Elixir's provisioned family client (app
  `clan`), which never expires; its redirect URI is
  `https://elixir.poapkings.com/api/clan/auth/callback`. Sign-ins stopping
  (the sessions in the table, read-only) with a redirect Elixir refuses go
  to Jamie, whose `family_clients` op sets the URI (`AGENTS.md`, "The
  seams to Elixir").
- **The table.** Sessions and logins carry TTLs; the ledger items do not.
  An item count that grows without a matching product reason is a leak.
- **Secrets.** Only through `{{resolve:secretsmanager}}` in the template;
  never `get-secret-value`. The `aws-secrets-manager` skill first for any
  secret task.

## Action

- A failed deploy, a broken smoke, an alarm with a cause in our code, a
  contract adaptation: fix in the run, with the test, as a PR
  that merges on a green `validate`; watch the merge SHA's deploy, read the
  smoke.
- A parameter change (`--param=Key=Value`) is a local deploy and is said so.
- Anything Elixir must change goes to Elixir (`elixir_feedback` or its
  AGENT-TEAM) as one concrete fact request; never a judgment.

## Success

The site answers, CI is green on `origin/main`, no alarm is unexplained,
the Elixir contract this product reads is the one Elixir serves, and
sign-in comes back to Clan.
