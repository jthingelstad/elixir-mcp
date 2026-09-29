/** The one cap on a tool result's text, shared by the MCP door, the web
 *  explorer and the invoker's audit (moved out of protocol.mjs on
 *  2026-09-29 so they reach it without importing the MCP door). */

import { responseMeta } from "@elixir-mcp/contracts";

export const MCP_RESULT_MAX_CHARS = 48_000;

/** Serialize a tool body under the result cap: over it, a small valid
 *  failure carrying the request receipt replaces the body. Shared by the
 *  MCP door and the web explorer so the cap is one number. The code is
 *  result_too_large (1.0.0): the request was fine, and an agent branches
 *  on the code. */
export function renderToolResultText(registry, name, invoked, kind = null) {
  // Compact JSON: MCP clients pay tokens per byte, and battle results are
  // deck-dense — indent-1 doubled their size past the cap for no benefit.
  let text = JSON.stringify(invoked ?? null);
  const truncated = text.length > MCP_RESULT_MAX_CHARS;
  let body = invoked;
  if (truncated) {
    const spec = registry.declarations(kind).find((d) => d.name === name);
    // A one-size tool publishes verbosity so clients may send it, but it
    // narrows nothing there (Gym #151: battles_decks was told compact is
    // usually enough, and a compact retry still read "verbosity full").
    const oneSize = /^This tool has one size/.test(
      spec?.inputSchema?.properties?.verbosity?.description ?? "",
    );
    const params = Object.keys(spec?.inputSchema?.properties ?? {}).filter(
      (p) => !(oneSize && p === "verbosity"),
    );
    const narrowing = params.filter((p) =>
      [
        "limit",
        "verbosity",
        "from",
        "to",
        "days",
        "weeks",
        "ids",
        "query",
        "min_battles",
        // elixir_timeline narrows by what it lists (Gym #122).
        "kinds",
        "sections",
      ].includes(p),
    );
    // The cap depends on what the rows hold, so a caller cannot size a
    // page up front (feedback #56: a full battles_query page of 25 was
    // over, and the schema had implied 25 was safe). Say the page that
    // fits: the limit that applied, scaled by the overrun, with room.
    const applied = Number(invoked?.applied?.limit);
    const fits =
      Number.isInteger(applied) && applied > 1
        ? Math.max(
            1,
            Math.floor((applied * MCP_RESULT_MAX_CHARS * 0.9) / text.length),
          )
        : null;
    const sizing =
      fits !== null && fits < applied
        ? ` This page was ${text.length} characters at limit ${applied}${
            invoked?.applied?.verbosity && !oneSize
              ? ` (verbosity ${invoked.applied.verbosity})`
              : ""
          }; a limit of ${fits} should fit the same arguments.`
        : "";
    // Compact is advice only to a call that was not already compact
    // (Gym #122: a compact call was told compact is usually enough).
    const wasCompact = invoked?.applied?.verbosity === "compact";
    const hint = narrowing.length
      ? `Narrow the arguments (${narrowing.join(", ")})${params.includes("verbosity") && !wasCompact ? "; verbosity: 'compact' is usually enough" : ""}.${sizing}`
      : params.length
        ? `Narrow the arguments (${params.join(", ")}).${sizing}`
        : "This tool has no narrowing arguments. Report this request_id with elixir_send_feedback.";
    // A sliced JSON document is not a usable tool result. Keep a small,
    // valid failure and its receipt; never discard metadata at the tail.
    body = {
      error: {
        code: "result_too_large",
        class: "input",
        message: `Result is ${text.length} characters; the cap is ${MCP_RESULT_MAX_CHARS}.`,
        hint,
      },
      meta: responseMeta({
        as_of: invoked?.meta?.as_of ?? new Date().toISOString(),
        ...(invoked?.meta?.request_id
          ? { request_id: invoked.meta.request_id }
          : {}),
        ...(invoked?.meta?.quota ? { quota: invoked.meta.quota } : {}),
      }),
    };
    text = JSON.stringify(body);
  }
  return { text, truncated, body };
}
