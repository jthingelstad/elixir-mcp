# 2026-10-13 — Native HTTP on Lambda Web Functions

Jamie approved the migration and a direct cutover after the architecture review.
Three native Hono HTTP servers replace API Gateway/Event Function HTTP doors.
CloudFront keeps the hostname and route boundaries, signs IAM origin requests
while preserving viewer bearer credentials, and routes the collector separately.
HomeRegion endpoints pin immutable revisions and VPC connector versions;
private RDS, the S3 outbox and all asynchronous Event Functions remain.

Exclusive process-local PostgreSQL pools replace per-request handshakes.
Web-api/MCP allow four connections and collector two, with at most two
environments each. Expired, failed and unfinished leases are destroyed;
normal release clears transaction, advisory-lock and session settings.
The request deadline includes pool acquisition. Shutdown is bounded to the
Web Function's one-second window.

The initial app document resolves its session and renders React on the server,
then hydrates with request-local account and Clan data and a shared first-render
clock; browser-only preferences and recent links load after hydration; magic-link fragments still finish
in the browser. Existing session cookies, signing keys, handoff, code redemption,
OAuth grants, credential audiences and CSRF checks remain. [engineering] Use the
existing universal router tree with explicit memory history rather than the
router's experimental streaming protocol. The Console brief's orientation and
privacy principles are unchanged; no new identity provider or account policy.

Migration 0226 adds only a public statistics projection table. The jobs Lambda
recomputes it hourly and the deploy publishes its first snapshot. The public
answer carries its timestamp and falls back to calculation after two hours.
Canonical records and the collector rate budget do not change.

The deploy versions source objects, publishes browser assets before the native
revision flip, owns endpoint-specific CloudFront policies inside the production
lock and reads back immutable routing. OAuth form-query spaces normalize before
origin signing; encoded literal pluses and repeated values stay intact. Native metrics/log paths replace the
Event Function alarms. Normal source/revision history remains; there is no
separate rollback endpoint or sustained parallel stack.

MCP 11.13.0 and JSON API 3.2.0 unchanged: tool declarations and results do not
change. Migration 0226. Acceptance scope is the shared MCP transport. The consistency trace checked the
three doors, credentials, source access, connection isolation, SSR and operational
pointers. It removed the retired API Gateway throttle scripts and corrected
initial browser-only state and native request latency accounting.
