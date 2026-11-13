# packages/tools: the tool registry

Every read Elixir answers, as MCP tools (`services/mcp`) and as the web
app's reads (`services/web-api`), plus the
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
- **Scope:** every read names a player or a clan; no tool reads a
  population or the corpus (the `segment` family retired in 13.0.0), and
  none answers a game-wide statistic or a recommendation
  (`docs/DECISIONS.md`).
- **One derivation:** a fact two doors serve comes from one function in
  `packages/record`. `/api/v1` mirrors no tool: it answers only
  `GET /api/v1/me` (`services/web-api/src/sign-in-api.mjs`).
- **Budgets:** an MCP result over `MCP_RESULT_MAX_CHARS`
  (`src/result-text.mjs`) is `result_too_large`, never a silent clip; reads
  race a `query_timeout` and a 5 s lock wait (`src/invoker.mjs`).
- **Database:** one `pg.Client` per call, so await queries one at a time
  (`services/mcp/test/pg-usage.test.mjs`). Tools never read `api_payload`.
- Tests: `npm test -w @elixir-mcp/tools` over scratch databases; seed
  played decks with `test/deck-rows.mjs`. Live checks of a deployed tool
  are the acceptance suite (`acceptance/README.md`).
