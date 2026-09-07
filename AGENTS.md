# AGENTS.md

Elixir MCP: records Clash Royale history (the official API is current-state
only) and serves it to players' own agents through an authenticated remote MCP
server. One hostname, `elixir.poapkings.com`: the site at /, the MCP/OAuth
door path-split at /mcp, /oauth/*, /.well-known/* behind a no-cookie
CloudFront behavior (consolidated from two hostnames 2026-09-03).

`CLAUDE.md` is a symlink to this file. Do not fork them.

**Start with `docs/DESIGN.md`** — the spec of record (v2, audited). Decisions
there and in `docs/NOTES.md` are ratified by Jamie; don't re-litigate them,
and record new ones in NOTES.md as they happen. The prior-art map (DESIGN §10)
says which existing repo to read before writing each subsystem.

## Golden rules

1. **This repo is PUBLIC and secrets never enter it — or agent context.**
   Local `.env` only (canonical var: `CR_API_TOKEN`; Drop's differing
   `CR_API_KEY` name is not ours), written by bootstrap scripts, mode 0600.
   Never read secret values into context; handle by file/name reference.
   Verify tracking with `git ls-files`, never trust `.gitignore` alone.
2. **Only the gateway calls the CR API at runtime.** The token lives solely on
   allowlisted-IP operator machines — never in CI, Lambda, or the browser.
3. **One global rate budget.** The gateway fleet is redundancy, never quota
   multiplication. This is ToS posture, not an optimization (DESIGN §5.2).
4. **CR tags are the only IDs for game entities.** One shared normalizer, no
   surrogate keys; accounts touch game data only through `claim` (DESIGN §4.1).
5. **`packages/contracts` is the single source of truth** for tool schemas,
   the error enum, `deck_hash`, and the meta envelope. Versioning rules:
   DESIGN §11.
6. **Schema changes are ordered migrations in `db/migrations`**, applied only
   by the migrate Lambda at deploy — never at handler start, never by hand.
   Expand-and-contract; canonical tables are lossless by policy.
7. **Never copy-paste code between repos.** Write fresh with the pattern open.
8. **`docs/cr-api-docs/` is CR API truth** — a git subtree of
   `jthingelstad/cr-agent-api-docs`, the canonical repo. When the live API
   surprises us, patch it as part of the fix, then push the learning back
   upstream so the other CR projects get it:

   ```sh
   git subtree pull --prefix=docs/cr-api-docs cr-api-docs main --squash
   git subtree push --prefix=docs/cr-api-docs cr-api-docs <branch>   # then PR
   ```

   Both need a clean working tree — commit first or subtree refuses.

   **What belongs upstream.** Elixir MCP is the RIGHT contributor of CR
   insight: it records many clans, so it sees API and game behavior that a
   single-clan tool cannot. Push findings that hold for ANY caller —
   endpoint shapes, field semantics, nullability, timing and reset
   behavior. Today's season-rollover finding is the model: the race ends
   ~09:30Z and the season rolls at 10:00Z, and live riverrace payloads
   carry no `seasonId`. That is true for everyone.

   **What does not.** Never push clan-specific material (POAP KINGS
   rosters, our fame, our members) and never notes about downstream
   consumers of the docs — that is the upstream repo's own standing rule.
   The docs describe the game and its API, not our use of them.

   Treat the tree as an upstream mirror: it is in `.prettierignore` and
   oxlint's `ignorePatterns` so it stays verbatim (reformatting it makes
   every future pull conflict — the same rule as `fixtures/`). elixir-bot
   carries a plain vendored copy of the same docs that has drifted — never
   treat that one as truth.
9. **Tests:** scratch databases generated per run (brew `postgresql@17`, no
   Docker); against live data, reads and refusal-paths only — never verify
   with writes.
10. **The unofficiality disclaimer** appears on every user-visible surface,
    including tool response metadata and this repo's README.

## AWS

- Always `--profile jamie`, region `us-east-1`. Hobby-account rules from
  `~/Projects/AGENTS.md` apply: smallest understandable solution, no em
  dashes in resource names.
- One CloudFormation stack in `infra/`. Port Drop's `parameters.mjs`
  discipline (SECRET/REQUIRED/PRESERVED with `UsePreviousValue`) — omitted
  parameters silently reset to template defaults.
- Alarms route to SNS `elixir-mcp-alarms` → the sysadmin `projects-ops-alerts`
  queue. No email subscriptions.
- Store UTC everywhere; timezone is a display concern.

## AGENT-TEAM

Standing maintenance is objective-owned: four owners defined in
`AGENT-TEAM/` (Run Elixir MCP, Keep the Record True, Close the Loop,
Guard the Door) run on the `automations.toml` schedules. Read order for
any objective run: this file -> `AGENT-TEAM/WORKFLOW.md` ->
`AGENT-TEAM/README.md` -> the objective file. EVERY mutating actor on
this checkout - objective run or interactive session - claims the
checkout lease first (`AGENT-TEAM/scripts/objective-lease.mjs`).

## Working style

- Work lands on `main`; CI (validate workflow) must stay green.
- **Docs ship with the change**: anything altering architecture or
  user-facing behavior updates the site docs (`apps/web/src/docs/`) and
  the What's-new list (`apps/web/src/updates.js`) in the same commit.
- `npm run verify` (prettier check + oxlint + all workspace tests) is the
  pre-push gate; `npm run format` fixes style. `npm run knip` hunts dead
  exports/deps — run it when refactoring, not every push.
- Commits are small and message-first; assert HEAD moved after committing
  (don't pipe commit output through `tail`).
- Manual steps only Jamie can do (Supercell keys, DNS, Fastmail tokens,
  first-run bootstrap) get queued in `docs/NOTES.md`, not silently blocked on.
- Collector (gateway) code lives in its OWN repo:
  `~/Projects/elixir-mcp-collector` (github jthingelstad/elixir-mcp-collector,
  split 2026-09-04). Pushing to that repo's main does NOT deploy it: a
  green push publishes a CANDIDATE (prerelease) that nobody runs, and it
  reaches the fleet only when this repo names it, which also promotes it
  to Latest. Named versions land on collectors within the hour. Follow
  `docs/RELEASING-COLLECTOR.md` — candidate, soak, name, verify, roll
  back — it carries the platform-key trap that fails silently. The queue
  contract stays canonical here in `packages/contracts` — contract
  changes land server-side first (operator pointer:
  `docs/OPERATORS.md`).

---

*This material is unofficial and is not endorsed by Supercell. For more
information see Supercell's Fan Content Policy:
www.supercell.com/fan-content-policy.*
