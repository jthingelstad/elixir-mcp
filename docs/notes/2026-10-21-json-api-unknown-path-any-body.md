# 2026-10-21 — An unknown /api/v1 path is a 404 whatever its body

JSON API 3.2.1 answers a method and path no operation serves with a 404
`not_found` that points to the docs, "whatever the credential". Codex on
#621 found one way around it: the web-api handler parses the body before
it dispatches, so `POST /api/v1/chat/completions` with a body that is not
JSON was still answered 400 `invalid_json`, and never learned where the
operations are.

The handler now lets an unparseable body through when the path names no
operation (`found.operation`, the same `v1Operation` lookup the request
line uses); `integrationApi` answers its 404 before it reads the body. A
real operation with a body that is not JSON is still 400 `invalid_json`,
before any credential, as `integrations.md` says. Both are pinned in
`integration-routing.test.mjs`.

JSON API 3.2.1, unchanged: the document does not move and the docs
already say "whatever the credential". MCP 11.13.3, unchanged; no tool
changed, so the deploy runs no acceptance family.
