import integrationContract from "@elixir-mcp/contracts/integration-api.openapi.json" with { type: "json" };

/** Every /api/v1 operation, by method and path template, as the OpenAPI
 *  document declares it: the one list, which the door already loads for
 *  its integration permissions (@elixir-mcp/auth/integrations).
 *
 *  It names the operation on the door's request line, which read only
 *  `/api/v1/*`, and it is how a path no operation answers gets a 404 that
 *  points to the docs before any credential is read (review 2026-10-21:
 *  142 `GET /api/v1/models` a week from OpenAI-style clients were
 *  answered 401, as if a key would have helped). A known operation is
 *  authenticated exactly as before. */
const MATCHERS = Object.entries(integrationContract.paths).flatMap(
  ([template, methods]) =>
    Object.entries(methods).map(([method, operation]) => ({
      method: method.toUpperCase(),
      pattern: new RegExp(
        `^/api/v1${template.replace(/\{[^}]+\}/g, "[^/]+")}$`,
      ),
      operationId: operation.operationId,
    })),
);

/** The operationId a request names, or null when no operation answers
 *  this method at this path. */
export function v1Operation(method, path) {
  const m = String(method ?? "GET").toUpperCase();
  const p = String(path ?? "");
  for (const op of MATCHERS)
    if (op.method === m && op.pattern.test(p)) return op.operationId;
  return null;
}
