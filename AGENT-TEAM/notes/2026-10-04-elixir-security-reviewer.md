# Elixir Security Reviewer — 2026-10-04

Reviewed `4c51d61f..ba4ed6d9` at MCP contract 11.1.0 and JSON API 3.0.0.
`AGENT-TEAM/scripts/preflight.sh` reported an observation-ready, mutation-
eligible worktree and a free deploy lease.

## Boundary evidence

- `git ls-files` found no tracked local environment files or credential
  material; secret-shaped matches were confined to intentional docs/examples
  and test fixtures. Linked local `.env` files resolve to mode 0600 and were
  not read.
- The deployed public status had five signed active collectors and one global
  1 request/second budget with a 10% live reserve. It reported 1,248 fetches
  in 24 hours, two live charges, and no evidence of fleet quota multiplication.
- Invalid Bearer credentials received 401 at MCP and `/api/v1`; OAuth discovery
  exposes the expected authorize, token and revocation endpoints. `npm run
  verify` passed the auth, principal isolation, audience, rotation, revocation,
  session and CSRF regressions, private-Clan boundary tests, model-bridge
  sealing and one-budget tests. The read-only deployed acceptance suite also
  completed against the authorized test principal.
- The deployed stack is `UPDATE_COMPLETE`, `ClanInternal=true`; its collector
  and email-relay functions are `UPDATE_COMPLETE`. The template confines model
  S3 reads/listing and claims/replies to their prefixes, and the relay has only
  its mail queue, scoped outbox access and SES sending identity.

## Decision queued

`apps/site/src/docs/privacy.md` still says that Elixir uses models to write
editorial mail and read feedback, and implies that sign-in subscribes a person
to Buttondown. The former worker retired and relay enrollment requires an
account opt-in. The privacy-policy decision requires Jamie, so Guard recorded
one concrete approval request with `objective-lease.mjs note guard`; no policy
text, runtime code, IAM policy, production state or lease was changed.
