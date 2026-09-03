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
8. **`~/Projects/cr-agent-api-docs` is CR API truth** (not elixir-bot's
   drifted vendored copy). When the live API surprises us, patch those docs
   as part of the fix.
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

## Working style

- Work lands on `main`; CI (validate workflow) must stay green.
- Commits are small and message-first; assert HEAD moved after committing
  (don't pipe commit output through `tail`).
- Manual steps only Jamie can do (Supercell keys, DNS, Fastmail tokens,
  first-run bootstrap) get queued in `docs/NOTES.md`, not silently blocked on.

---

*This material is unofficial and is not endorsed by Supercell. For more
information see Supercell's Fan Content Policy:
www.supercell.com/fan-content-policy.*
