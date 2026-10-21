# 2026-10-21 — JSON API 3.2.1: unknown paths, the operation on the line, exact Retry-After

Four corrections from the platform review of 2026-10-21, none of which
changes what a real operation answers to a caller it admits.

**A path no operation answers is a 404 that points to the docs.** The
week to 10-21 had 142 `GET /api/v1/models` from OpenAI-style clients,
each answered 401 `unauthenticated`, which told them a key would help.
`integrationApi` now asks `v1Operation(method, path)`
(`services/web-api/src/v1-operations.mjs`, built from the OpenAPI
document's `paths`, which the door already loads for its integration
permissions) before it reads a credential; nothing matches, and the
answer is 404 `not_found` whose `detail` names `/docs/json-api` and
`/docs/integration-api.json`. Nothing is authenticated, audited or
counted for it. Every operation in the document is matched exactly
(method and path, `{param}` as one segment), and still answers 401 with
no credential or an unknown one: `integration-routing.test.mjs` walks
every operation both ways, and every unknown path with no key, a foreign
key, an integration key and a person's grant.

**The request line names the operation.** The door's timing line read
`GET /api/v1/*` for every call, so a slow or failing operation could not
be told from another. It now carries `operation`, the operationId
(`gameClock`, `clanRoster`, ...), beside the unchanged `http` key; an
unknown path has none.

**The hourly 429's Retry-After counts seconds.** Both hourly refusals
(`rest-hour:` for an integration, `rest-person-hour:` for a person)
computed `3600 - minutes * 60`: up to 59 seconds too long (60 at
12:59:59, when one was left). `secondsLeftInHour()` takes the seconds to the top of
the same window `checkRateLimit` keys on, never less than 1, as the MCP
door's 429 already did.

**`x-principals` on every operation.** `gameClock`, `playerProfile`,
`requestProfileRefresh`, `profileRefreshStatus`, `playerFactWrite` and
`clanMailSend` named none and meant integration (the document's own
rule); each now says `["integration"]`, which is what the code admits
and what their `security` already said.

JSON API 3.2.1 (a patch: no field, operation or admitted caller
changes; the pin moves because `paths` did). The two docs pages lose a
stale "the current version is 3.1.0" rather than gain a number that
drifts again. MCP 11.13.3, unchanged; no tool changed, so the deploy
runs no acceptance family.
