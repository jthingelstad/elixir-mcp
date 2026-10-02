/** Called only by the frozen legacy adapter, before any business request. */
export function frozenClanResponse(event) {
  if (event?.scheduled === "evaluate") return { skipped: "migration_frozen" };
  const path = event?.rawPath ?? event?.path;
  const method =
    event?.requestContext?.http?.method ?? event?.httpMethod ?? "GET";
  if (method === "GET" && ["/health", "/api/clan/health"].includes(path))
    return null;
  return {
    statusCode: 503,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "retry-after": "60",
    },
    body: JSON.stringify({
      error: "clan_migration",
      message: "Clan is moving into Elixir. Try again shortly.",
    }),
  };
}
