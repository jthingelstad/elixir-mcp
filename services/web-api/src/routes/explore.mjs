import { TOOL_GROUPS } from "@elixir-mcp/contracts";
import { checkRateLimit } from "@elixir-mcp/auth";
import { makeInvoker } from "../../../mcp/src/invoker.mjs";
import { makeQuota, HOURLY_RATE_LIMIT } from "../../../mcp/src/quota.mjs";
import {
  renderToolResultText,
  MCP_RESULT_MAX_CHARS,
} from "../../../mcp/src/protocol.mjs";

import { json } from "../http.mjs";

/**
 * Writes the console itself performs through the bridge. The explorer is a
 * read surface; the one exception is the nickname editor, which is a
 * console feature on a cookie-authenticated, CSRF-checked session - the
 * person's own account:write. Everything else that changes state has its
 * own route or belongs at the MCP door under its OAuth capability.
 */
const CONSOLE_WRITES = new Set(["elixir_nickname"]);

function explorable(tool) {
  const cls = TOOL_GROUPS[tool];
  if (!cls || tool === "live_fetch") return false;
  return cls.readOnly || CONSOLE_WRITES.has(tool);
}

export function exploreRoutes({ resolveAccount, exploreRegistry, track }) {
  return {
    "POST /api/explore": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthenticated" });
      const tool = String(body.tool ?? "");
      const registry = exploreRegistry();
      if (!registry.has(tool) || !explorable(tool)) {
        return json(400, {
          error: "bad_request",
          message: `Unknown or non-explorable tool: ${tool}`,
        });
      }
      // The same door discipline as /mcp (handler.mjs), same buckets: the
      // explorer used to be an unmetered, uncapped path to every tool.
      const withinRate = await checkRateLimit(db, {
        bucket: `mcp#${account.accountId}`,
        max: HOURLY_RATE_LIMIT,
      });
      if (!withinRate) return json(429, { error: "rate_limited" });
      const quota = await makeQuota({ db, account })();
      if (!quota.allowed) {
        return json(429, {
          error: "quota_exceeded",
          message: `Daily tool-call quota reached (${quota.max} per day). It resets at midnight UTC.`,
        });
      }
      const invoke = makeInvoker({
        db,
        account,
        registry,
        surface: "web",
        track,
      });
      const args = body.args && typeof body.args === "object" ? body.args : {};
      const result = await invoke(tool, args);
      // One result cap for every door: over it, the same bounded failure
      // the MCP door returns, never a body the page cannot hold.
      const { text, truncated } = renderToolResultText(
        registry,
        tool,
        result.body,
      );
      return json(200, {
        tool,
        is_error: result.isError === true || truncated,
        body: truncated ? JSON.parse(text) : result.body,
        ...(truncated ? { result_cap_chars: MCP_RESULT_MAX_CHARS } : {}),
      });
    },
  };
}
