# Guard the Door — 2026-09-27

Reviewed `ddf313d..c8ae0400` (tool contract 6.1.0 through 9.12.0) after
`AGENT-TEAM/scripts/preflight.sh` reported observation available and mutation
eligible. The checkout was clean and synchronized before the Guard lease was
claimed.

## Boundary evidence

- A tracked-file secret scan found only intentional placeholders, documentation
  examples, and test fixtures; local `.env` files are mode 0600 and were not
  read.
- Public status was healthy: no DLQ backlog, five signed collectors, and one
  global budget at 1 request/second with a 3,600/hour ceiling. This confirms
  the fleet remains a redundancy mechanism, not a quota multiplier.
- Invalid Bearer probes to both `/mcp` and `/api/v1` were refused with 401,
  without a cookie; discovery exposes the MCP resource and authorization
  server boundary. Auth, MCP, and REST suites cover audience, family-account,
  map-isolation, refresh-reuse, and service-token refusal paths.
- The deployed relay role remains limited to its email queue, the `email/`
  outbox prefix, and SES sends from the service identity. The editor role is
  separately limited to its `editor/` prefix, editor queue, archive mail
  records, and named job invocations. SES publishes bounce, complaint, reject,
  and rendering-failure events only; it does not collect open or click events.

## Finding and repair

The email relay's best-effort failure logs emitted untrusted error strings.
Transport errors can include recipient addresses or message content, contrary
to the privacy boundary. The new regression first captured a recipient and
private-body string in all four delivery/error paths. The relay now emits only
the bounded `transport_error` class (and `invalid_message` for rejected owner
notifications), preserving the operational signal without retaining
third-party data.

Focused relay, auth, MCP, and JSON API tests pass after the repair. The
canonical `npm run verify` gate passed. PR #56 merged as `76f68c6d` after its
green `validate` check, and deployment completed with zero migrations and a
clean public smoke; no tool changed, so tool-family acceptance was not run.

Post-deploy read-only acceptance found `/api/public/status` healthy (zero DLQ
messages), five active signed collectors, and the singleton 1 request/second,
3,600/hour budget with its 10% live reserve. Invalid credentials at both MCP
and `/api/v1` received 401 responses without a cookie. No production email was
sent to test a privacy boundary.
