# packages/tools: the tool registry

Every read Elixir answers, as MCP tools (`services/mcp`) and as the JSON
API's mirrored operations (`services/web-api`, `/api/v1`), plus the
invoker, quota, identity, live fetch and call capture around them. The
contract (version, changelog, errors, groups, principals, the OpenAPI
document) is `packages/contracts`. To add or change a tool, follow
`.claude/skills/tool-change/` from its first step.

- **Layout:** `src/tools.mjs` assembles the registry from the per-group
  modules in `src/tools/`; a declaration (JSON Schema, description) sits
  with its handler, and its output schema in `src/output-schemas.mjs`.
  Every tool is in a group in `contracts/src/tool-groups.ts`, and the site
  has one generated reference page per group.
- **Conventions** are in `docs/ENGINEERING.md` ("Tool conventions") and are
  tested: `services/mcp/test/tool-conventions.test.mjs`,
  `test/tool-schema-lint.test.mjs`, `test/docs-pointers.test.mjs` (every
  `docsRef` resolves to a built page and H2).
- **Scope:** segment tools name a recorded population (`"mine"` or one
  player or clan) and refuse corpus or collection selectors; no tool
  answers a game-wide statistic or a recommendation (`docs/DECISIONS.md`).
- **One derivation:** a fact two doors serve comes from one function in
  `packages/record`; `services/web-api/test/record-parity.test.mjs` and
  `services/web-api/test/integration-pin.test.mjs` hold MCP and `/api/v1`
  together. A field removed from a tool an `/api/v1` operation mirrors is
  a JSON API major: stop for Jamie.
- **Budgets:** an MCP result over `MCP_RESULT_MAX_CHARS`
  (`src/result-text.mjs`) is `result_too_large`, never a silent clip; reads
  race a `query_timeout` and a 5 s lock wait (`src/invoker.mjs`).
- **Database:** one `pg.Client` per call, so await queries one at a time
  (`services/mcp/test/pg-usage.test.mjs`). Tools never read `api_payload`.
- Tests: `npm test -w @elixir-mcp/tools` over scratch databases; seed
  played decks with `test/deck-rows.mjs`. Live checks of a deployed tool
  are the acceptance suite (`acceptance/README.md`).
