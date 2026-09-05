/**
 * The audited tool invoker: every call — success or structured failure —
 * lands one bounded mcp_call_audit row (§11.3, the tuning loop's
 * evidence). ToolFailure renders as {error: {code, message, hint}} with
 * isError; unexpected errors render opaque (no internals cross the
 * boundary) and still audit.
 */

import { responseMeta } from "@elixir-mcp/contracts";
import { ToolFailure } from "./tools.mjs";

const MAX_AUDIT_ARG_CHARS = 4000;

async function audit(
  db,
  {
    accountId,
    surface,
    tool,
    args,
    startedAt,
    resultBytes,
    truncated,
    errorCode,
  },
) {
  try {
    await db.query(
      `insert into mcp_call_audit (account_id, surface, tool, args, duration_ms, result_bytes, truncated, error_code)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        accountId,
        surface,
        tool,
        JSON.stringify(args ?? {}).slice(0, MAX_AUDIT_ARG_CHARS),
        Date.now() - startedAt,
        resultBytes ?? null,
        truncated ?? false,
        errorCode ?? null,
      ],
    );
  } catch {
    // Telemetry must never break serving (house rule).
  }
}

export function makeInvoker({
  db,
  account,
  registry,
  live = null,
  surface = "mcp",
  track = null,
}) {
  return async function invokeTool(name, args) {
    const startedAt = Date.now();
    // Ambient product signal (Tinylytics): tool name only, never args.
    if (track) {
      try {
        await track(
          surface === "web" ? "explore.tool_call" : "mcp.tool_call",
          name,
        );
      } catch {
        // Analytics must never break serving (house rule).
      }
    }
    try {
      const body = await registry.invoke(name, { db, account, live }, args);
      const resultBytes = JSON.stringify(body).length;
      await audit(db, {
        accountId: account.accountId,
        surface,
        tool: name,
        args,
        startedAt,
        resultBytes,
      });
      return { body, isError: false };
    } catch (err) {
      if (err instanceof ToolFailure) {
        await audit(db, {
          accountId: account.accountId,
          surface,
          tool: name,
          args,
          startedAt,
          errorCode: err.code,
        });
        return {
          body: {
            error: {
              code: err.code,
              message: err.message,
              ...(err.hint ? { hint: err.hint } : {}),
            },
            meta: responseMeta({ as_of: new Date().toISOString() }),
          },
          isError: true,
        };
      }
      await audit(db, {
        accountId: account.accountId,
        surface,
        tool: name,
        args,
        startedAt,
        errorCode: "internal",
      });
      return {
        body: {
          error: {
            code: "bad_request",
            message: `Tool ${name} failed unexpectedly.`,
          },
          meta: responseMeta({ as_of: new Date().toISOString() }),
        },
        isError: true,
      };
    }
  };
}
