# Guard the Door — 2026-09-14

Reviewed revision `52bad21` against contract `3.0.0` and the current Guard reading map. Preflight was observation-available and mutation-eligible with no queued notes; the checkout was clean and synchronized.

## Evidence

- Public-repo hygiene: `git ls-files` and a redacted secret-shape scan found only the canonical `CR_API_TOKEN` templates in `apps/site/src/docs/operators.md`, `apps/web/src/views/CollectorDetail.jsx`, and `infra/scripts/provision-gateway.mjs`. The four local `.env*` files are untracked; the three non-example files are mode `0600`.
- Boundary review: the changes since `924d1ad` add the timeline and console foundation but no credential source, environment variable, third-party destination, IAM grant, or queue consumer. Existing external destinations remain Tinylytics and the email relay's Fastmail/Buttondown integrations. The deployed role set is unchanged and `UPDATE_COMPLETE`; roles retain only their expected AWS managed execution policy plus their stack inline policy.
- Principal and door matrix: MCP and web-api tests cover agent ownership and private timelines, wrong-resource/refused credentials, OAuth owner-only agent consent and scope/audience refusal, rotation/revocation, REST/MCP credential separation, integration grants, and agent-to-owner shared quotas. Live invalid bearer probes returned `401` for both `/mcp` and `/api/v1/game/clock`; the MCP response supplied the protected-resource challenge and no `Set-Cookie`. OAuth discovery, CSP and HSTS were present live.
- One-key posture: the live public status at 2026-09-14T07:19Z reported a healthy recorder (32-second fetch/admission freshness, zero DLQ, 626 battles/hour) and a singleton 1 rps budget with 10% live reserve (198/3,600 requests in the current hour). Static scheduler review confirms `budget_state` settlement and the only CR paths remain in the collector queue contract.
- Validation: `npm test -w @elixir-mcp/mcp`, `npm test -w @elixir-mcp/web-api`, `npm test -w @elixir-mcp/web`, `npm run verify`, and `npm run e2e` all passed. The Knip CSS compiled-extension configuration hint is unchanged and non-failing.

## Finding

No Guard-owned defect or decision. Public status still reports 101 capture-audit gaps in 7,126 polls; this is the standing Run Elixir MCP / Keep the Record True watch, not a security-boundary exception.
