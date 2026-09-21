/**
 * A door that answers from captured calls, so a case can be run against
 * what the product answered on a day it was wrong ("prove it bites",
 * acceptance/README.md). Captures are the archive bucket's objects
 * (services/mcp/src/capture.mjs): `{ request: { tool, arguments },
 * response }`, the response being the tool body - or the error body the
 * caller saw. A read the captures do not hold answers `not_captured`,
 * which fails the case for the right reason.
 */

export function replayDoor(captures, { tools = [] } = {}) {
  const key = (tool, args) => `${tool}:${canonical(args ?? {})}`;
  const index = new Map(
    captures.map((c) => [key(c.request.tool, c.request.arguments), c]),
  );
  return {
    async toolsList() {
      return tools;
    },
    async call(tool, args = {}) {
      const c = index.get(key(tool, args));
      if (!c)
        return {
          body: {
            error: {
              code: "not_captured",
              message: `no capture of ${tool} ${JSON.stringify(args)}`,
            },
          },
          isError: true,
          ms: null,
        };
      const isError = Boolean(c.response?.error && !c.response?.notes);
      return { body: c.response, isError, ms: c.timings?.db_ms ?? 0 };
    },
  };
}

/** JSON with keys sorted at every level, so argument order never decides
 *  whether a capture matches. */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
