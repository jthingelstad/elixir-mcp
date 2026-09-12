# Guard the Door — 2026-09-12

Reviewed source revision `58ac1f7ae173af6c95d37f0e67c8fdf2b827a31f` and all changes since the
previous successful guard review (`2026-09-11T07:15Z`), including the current
roles, agents, integrations, connections, privacy and limits contracts plus
the authorization tests and the post-review observability diff.

Preflight at `2026-09-12T07:15Z`: observation available, mutation eligible,
checkout clean and synchronized, no lease held, and no queued notes. The public
status reader reported healthy, 433 battles in the preceding hour, 44 capture
audit gaps across 4,206 polls, and no DLQ messages. Those gaps remain a
Run/Record coverage watch, not a Guard entitlement or privacy defect.

Boundary evidence: `git ls-files` secret-shape sweep found only examples,
migrations and the bootstrap helper; tracked-content scan found no credential
values. Every local `.env` file is untracked and mode 0600. The latest diff
adds browser timeout/error telemetry only: route labels collapse identifiers,
and values exclude URLs, request bodies and error text. The relay remains the
only server-side internet egress; its Tinylytics messages contain bounded event
names/categories, and its Buttondown path is limited to opted-in sign-in
addresses without overriding an unsubscribe. IAM remains prefix-scoped for the
call archive and VPC Lambdas retain no general internet route.

Verification: `npm test --workspace @elixir-mcp/auth`,
`npm test --workspace @elixir-mcp/mcp`, and
`npm test --workspace @elixir-mcp/web-api` all passed. Read-only live checks:
`GET /api/public/status` returned 200 and healthy (last admission/fetch 257 s,
0 DLQ); an invalid bearer at `/mcp` returned 401 with the protected-resource
challenge and no cookie; `/account/overview` returned CSP restricted to self
plus Tinylytics and HSTS. `AWS_PROFILE=jamie node infra/scripts/smoke.mjs` was
blocked before its first probe by `ExpiredToken`; no deployment or write was
attempted. Renew Jamie's AWS session before an AWS-backed smoke or deployment.

