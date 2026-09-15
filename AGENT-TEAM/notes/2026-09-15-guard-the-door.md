# Guard the Door — 2026-09-15

Reviewed revision `db82dc4` against contract `3.3.0`, the changed decisions from
the prior Guard receipt (`52bad21`, 2026-09-14), and the current Guard reading
map. Preflight at 2026-09-15T07:15Z was observation-available and
mutation-eligible; the checkout was clean, synchronized, and had no queued
notes.

## Evidence

- **Public-repo hygiene:** `git ls-files` plus filename-only literal scans found
  no AWS access keys, private-key blocks, GitHub tokens, or Slack tokens. The
  only tracked secret-shaped filenames are migrations and provisioning helpers;
  local `.env` remains ignored and mode `0600`. Canonical token references are
  templates and tests, not tracked credentials.
- **Changed-surface review:** commits since the prior review are backfill,
  migration, cards/deck projections, and query-budget work. They add no auth or
  entitlement declaration, credential source, environment variable, IAM grant,
  third-party destination, or queue consumer. The backfill helper invokes the
  existing migrate Lambda and archive path; it does not call the Clash Royale
  API or add egress.
- **Principal and door matrix:** the current Roles, Agents, Connections,
  Integrations, Privacy, and Limits contracts preserve private account state,
  agent-owned cursors and identity maps, REST/MCP credential separation,
  owner-only agent consent, explicit integration grants, shared owner budgets,
  scope/audience enforcement, rotation/revocation, and scheduled retention.
  `npm run verify` passed all format, lint, Knip, type, migration, auth,
  principal, quota, integration, collector-door, and workspace tests.
- **Live refusal paths:** invalid bearer probes returned `401` at both `/mcp`
  and `/api/v1/game/clock`; neither set a cookie. The OAuth protected-resource
  and authorization-server discovery documents returned `200`; all five public
  probes carried HSTS and CSP.
- **One-key / deployed posture:** public status reported last fetch and
  admission at 1 second, zero DLQ messages, 755 battles in the last hour, and
  91 capture gaps across 6,997 polls. `AWS_PROFILE=jamie` resolved the intended
  account and CloudFormation `elixir-mcp` was `UPDATE_COMPLETE` at
  2026-09-15T06:28:47Z. No infrastructure diff occurred in this review window.

## Finding

No Guard-owned defect or decision. The 91 capture-audit gaps remain the
standing Run Elixir MCP / Keep the Record True watch, not a door-boundary
exception.
