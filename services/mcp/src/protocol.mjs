/**
 * MCP protocol layer — librarian's pattern (its shipped lessons kept):
 * stateless streamable HTTP, one JSON-RPC message per POST; batching
 * rejected (removed in the 2025-06-18 revision); listChanged declared
 * true because the list DOES change across deploys and a stateless server
 * can never deliver the notification — serverInfo.version is the honest
 * cache key, changing exactly when the tool surface does; results capped
 * with a hint naming the tool's own parameters.
 */

import crypto from "node:crypto";
import { CONTRACT_VERSION, DISCLAIMER } from "@elixir-mcp/contracts";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26"];
const MCP_RESULT_MAX_CHARS = 48_000;
export const MCP_QUOTA_ERROR_CODE = -32029;

export function serverVersion(declarations) {
  const fingerprint = crypto
    .createHash("sha256")
    .update(JSON.stringify(declarations))
    .digest("hex")
    .slice(0, 12);
  return `${CONTRACT_VERSION}+tools.${fingerprint}`;
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id, code, message, data) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

function initializeResult(registry, requestedVersion) {
  const declarations = registry.declarations();
  const requested = String(requestedVersion ?? "");
  return {
    protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
      ? requested
      : MCP_PROTOCOL_VERSION,
    capabilities: { tools: { listChanged: true } },
    serverInfo: {
      name: "elixir-mcp",
      title: "Elixir MCP - Clash Royale history, recorded",
      version: serverVersion(declarations),
      websiteUrl: "https://elixir.poapkings.com/",
    },
    instructions: [
      "Recorded Clash Royale history for claimed players: battles, performance,",
      "snapshots, coverage. Start with list_my_players to see claimed tags and",
      "recording status; get_coverage tells you how complete the record is —",
      "caveat answers when it says the capture is incomplete. All tags are CR",
      `tags like #20JJJ2CCRU. Tool schemas evolve; if serverInfo.version differs`,
      "from your cached value, re-fetch tools/list.",
      DISCLAIMER,
    ].join(" "),
  };
}

function renderToolResultText(registry, name, invoked) {
  // Compact JSON: MCP clients pay tokens per byte, and battle results are
  // deck-dense — indent-1 doubled their size past the cap for no benefit.
  let text = JSON.stringify(invoked ?? null);
  const truncated = text.length > MCP_RESULT_MAX_CHARS;
  if (truncated) {
    const spec = registry.declarations().find((d) => d.name === name);
    const params = Object.keys(spec?.inputSchema?.properties ?? {});
    const hint = params.length
      ? `narrow the arguments (${params.join(", ")})`
      : "ask a narrower question";
    text =
      text.slice(0, MCP_RESULT_MAX_CHARS) +
      `\n... [truncated at ${MCP_RESULT_MAX_CHARS} characters; ${hint} for a complete result]`;
  }
  return { text, truncated };
}

/**
 * One JSON-RPC message in, one HTTP-ready reply out.
 * context: { registry, spendQuota(), invokeTool(name, args) }
 */
export async function handleMcpMessage(message, context) {
  if (Array.isArray(message)) {
    return {
      statusCode: 400,
      payload: rpcError(null, -32600, "Batched requests are not supported."),
    };
  }
  const record = message && typeof message === "object" ? message : null;
  if (
    !record ||
    record.jsonrpc !== "2.0" ||
    typeof record.method !== "string"
  ) {
    return {
      statusCode: 400,
      payload: rpcError(null, -32600, "Expected a JSON-RPC 2.0 request."),
    };
  }
  const { method } = record;
  const id = "id" in record ? record.id : undefined;
  const params =
    record.params && typeof record.params === "object" ? record.params : {};

  if (id === undefined) return { statusCode: 202, payload: null }; // notifications
  if (method === "initialize") {
    return {
      statusCode: 200,
      payload: rpcResult(
        id,
        initializeResult(context.registry, params.protocolVersion),
      ),
    };
  }
  if (method === "ping") return { statusCode: 200, payload: rpcResult(id, {}) };
  if (method === "tools/list") {
    return {
      statusCode: 200,
      payload: rpcResult(id, { tools: context.registry.declarations() }),
    };
  }
  if (method === "tools/call") {
    const name = String(params.name ?? "");
    if (!context.registry.has(name)) {
      return {
        statusCode: 200,
        payload: rpcError(id, -32602, `Unknown tool: ${name}`),
      };
    }
    const quota = await context.spendQuota();
    if (!quota.allowed) {
      return {
        statusCode: 200,
        payload: rpcError(
          id,
          MCP_QUOTA_ERROR_CODE,
          `Daily tool-call quota reached (${quota.max} per day). It resets at midnight UTC.`,
        ),
      };
    }
    const args =
      params.arguments && typeof params.arguments === "object"
        ? params.arguments
        : {};
    const invoked = await context.invokeTool(name, args);
    // Agents self-moderate better than they handle walls: quota headroom
    // rides every response meta (owner is uncapped — no quota block).
    if (Number.isFinite(quota.max) && invoked.body?.meta) {
      invoked.body.meta.quota = { used: quota.count, max: quota.max };
    }
    const { text } = renderToolResultText(context.registry, name, invoked.body);
    return {
      statusCode: 200,
      payload: rpcResult(id, {
        content: [{ type: "text", text }],
        isError: invoked.isError === true,
      }),
    };
  }
  return {
    statusCode: 200,
    payload: rpcError(id, -32601, `Method not found: ${method}`),
  };
}
