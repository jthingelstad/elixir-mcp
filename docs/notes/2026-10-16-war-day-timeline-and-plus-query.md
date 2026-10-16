# 2026-10-16 — The war-day timeline and a plus in the query

Two live defects, fixed together on Jamie's go.

## elixir_timeline threw on a war day (MCP 11.13.1)

11.8.0 (df07bec6) moved the war deck tally's gate into
`warDeckTallyOpen` and passed it `Date.now()`, which removed the
`nowMs` declaration in `buildClanEntry` while the tally's `as_of` still
read it. The branch runs only on the war day in progress of the week in
progress, before the race finishes, so nothing failed until war day 1 of
the next week (2026-10-15 10:18Z): from then every timeline read that
built a tracked clan's entry threw `ReferenceError: nowMs is not
defined`. That was every `elixir_timeline` call that reached such a
clan, the Discord agent's editor routine, the `elixir-mcp-timeline-sync`
Function (its messages went to the dead-letter queue) and the email and
account readers that import the module.

`buildClanEntry` reads the clock once again, for the gate and for
`as_of`. The function has no injected clock; it reads `Date.now()` as
the rest of the module does. A test in `activity-entries.test.mjs` pins
the clock inside a war day and asserts the tally; it failed with the
production `ReferenceError` before the fix. oxlint now runs `no-undef`,
which finds exactly this one reference in the tree without the fix, so
an undeclared name fails `npm run verify`.

## A literal plus in the query got CloudFront's 403

Since the doors became Web Functions behind origin access control,
CloudFront signs each origin request with SigV4, and a raw `+` in a
forwarded query breaks the signature: the edge answered its own 403 HTML.
`OauthQueryNormalizer` already rewrote `+` to `%20` on `/oauth/authorize`
only. Every other door behaviour failed the same way (read 2026-10-16:
`/clan/*?find=King+Thing`, `/console`, `/api/*`, `/api/v1/*`,
`/api/public/*`, `/mcp`, `/a/*`, `/oauth/*`, `/.well-known/*`,
`/api/collector/*`). Real callers: Clan's roster find
(`Clan.jsx`, `MemberActivity.jsx`, through `URLSearchParams`, which
writes a space as `+`) and the admin feedback filter (`apps/web/src/api.js`).

The same function is now the viewer-request function on every behaviour
whose origin is a Web Function. Each had none, so nothing is folded. The
default behaviour keeps SpaRouter alone: its failover to the web API was
unaffected. The doors read the query with `URLSearchParams`
(`packages/http/src/server.mjs`), where `+` and `%20` are both a space,
so the rewrite keeps the meaning; `%2B` stays a literal plus. The
function keeps its logical id and Name, since renaming replaces a
function attached to the live distribution. `infra-controls.test.mjs`
holds every door behaviour to exactly one viewer-request association,
this one. elixir.poapkings.com is the only distribution in the account
in front of Elixir's Web Functions.

Versions: MCP 11.13.1; JSON API 3.2.0, unchanged.
