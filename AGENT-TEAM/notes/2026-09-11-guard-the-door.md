# Guard the Door — 2026-09-11

Reviewed `ddd13a7fb24d470a6c38ca6240f89cb899b38783` and the contract changes
since the prior scheduled review, including roles, agents, connections,
integrations, privacy, limits, contract changelog 1.0.0–1.5.0, and the current
decision ledger.

Preflight at 2026-09-11T07:15Z: observation available and mutation eligible;
checkout clean, synchronized and note queue empty. Public status was reachable;
the recorder reported 537 battles in the preceding hour, six 24-hour capture
audit gaps, and no DLQ messages. The gaps are a Run/Record watch, not an
entitlement or privacy failure.

Finding repaired: call capture redacted `token` but not `access_token` or
`refresh_token`, so an otherwise refused tool request could archive a pasted
credential for the 90-day capture window. A non-secret sentinel reproduced the
gap. `services/mcp/src/invoker.mjs` now redacts access, refresh, ID,
client-secret, PKCE and private-key forms; the capture regression verifies that
the archived request contains only `[redacted]`.

Boundary evidence: tracked paths contained only examples, migrations and the
secret bootstrap helper; tracked-content scan found only test fixtures; local
environment files are untracked and mode 0600. Deployed IAM grants the MCP role
only `s3:PutObject` under `calls/*` and the web role only `s3:GetObject` there.
The archive blocks public access and expires `calls/` after 90 days. New IAM
from the reviewed diff was limited to those two prefix-scoped actions. No new
runtime outbound call site was introduced; private VPC subnets have no default
internet/NAT route, while the relay is the dedicated egress component.

Read-only/live refusal acceptance: public status returned 200; the public MCP
door returned 401 plus its resource challenge for an invalid bearer; both direct
API Gateway doors returned 403 without CloudFront's origin header. The one-key
budget remains one 3,600/hour bucket with a 10% live reserve; status showed 374
receipts in the current hour and migrate `{stats:true}` returned successfully.

Verification: `npm test --workspace @elixir-mcp/mcp` (249 passing),
`npm test --workspace @elixir-mcp/web-api` (96 passing), and
`npm test --workspace @elixir-mcp/auth` (28 passing). Full `npm run verify`
passed before commit `f8462e2`. The commit was pushed and the full deployment
completed at 2026-09-11T07:23Z (`UPDATE_COMPLETE`, migrations 70/0); the
post-deploy smoke suite passed, including OAuth discovery, MCP 401 refusal,
origin refusal, CSP, HSTS, no-cookie API behavior and public status.
