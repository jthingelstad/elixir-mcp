# Guard the Door — 2026-09-13

Reviewed source revision `519fd33b8574c5c4461b52a1e7bda14cc642f6ce` and the changes since Guard's
successful 2026-09-12 review (`04c1349`). The changed boundary surfaces were
the sign-in/session and OAuth-consent flow, `account:email`, principal
isolation, and the collector-door metric display; the current roles, agents,
integrations, connections, privacy and limits contracts were read with contract
version 1.9.0 and the 2026-09-12/13 decision ledger entries.

Preflight at 2026-09-13T07:17Z reported observation available, mutation
eligible, no queue and healthy public state. The status reader showed fresh
fetch/admission, empty DLQs/dead work, five active collectors, one global
1 request/s budget (`capacity_hour: 3600`), and no live reserve consumption.
The 93 capture gaps in 5,117 polls are the existing Run/Record coverage watch,
not an entitlement or data-boundary failure.

Tracked-file and content secret-shape scans returned no keys, token values,
dotenv files or dumps. All local non-example `.env` files were untracked and
mode 0600. Review of the post-Guard diff found no new third-party recipient or
email path, queue consumer, IAM grant, or runtime credential value; the only
new runtime configuration is a dynamic reference to the existing session
secret for the narrowly cookie-enabled `/oauth/authorize` behavior. The MCP,
agent and REST doors remain cookie-free, and the consent behavior forwards
only the `__Host-elixir_session` cookie.

Focused scratch-database authorization coverage passed: 77 cases across auth,
OAuth routes/session consent, principal isolation, REST integrations and
sign-in handoff. That includes revoked/expired credential refusals,
wrong-resource separation, owner-only agent consent, independent integration
credentials/quotas, principal-private feeds/cursors and token lifecycle.
Live read-only acceptance: public status returned 200/healthy; `/account/overview`
returned the self-only CSP and two-year HSTS; an intentionally invalid bearer
at `/mcp` returned 401 with the protected-resource challenge and no cookie.

Finding fixed: `/docs/limits` still said a console session slid for nine days,
despite `SESSION_TTL_SECONDS` enforcing 30 days and the 2026-09-12 published
sign-in update already stating 30 days. A new rendered-doc regression failed
against the stale page, then passed after correcting the retention row. This is
a public-contract correction only; no runtime or deployment change is needed.
