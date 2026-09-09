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
import {
  CONTRACT_VERSION,
  DISCLAIMER,
  responseMeta,
} from "@elixir-mcp/contracts";
import {
  identitySentences,
  principalBlock,
  PRINCIPAL_META_KEY,
} from "./identity.mjs";
import { quotaMeta } from "./quota.mjs";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26"];
export const MCP_RESULT_MAX_CHARS = 48_000;
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

/**
 * The opening brief, written for the principal actually connecting.
 *
 * This used to say "Start with elixir_my_players for the caller's added
 * players" to everyone, which is exactly wrong for an agent: its owner's
 * claimed players are not its subject, and following that instruction is how a
 * clan bot ends up reciting somebody's personal tags. The bootstrap question
 * for an agent is not "who am I" but "what do I serve".
 */
function instructionsFor(kind, identity) {
  const shared = [
    "Recorded Clash Royale history: battles, performance, snapshots, war,",
    "coverage - all recorded game data is readable by every account.",
    "elixir_coverage tells you how complete a record is - caveat answers when",
    "capture is incomplete. game_clock answers what season and war day it is",
    "without reference to any clan. All tags are CR tags like #20JJJ2CCRU.",
    "Tool schemas evolve: if serverInfo.version differs from your cached",
    "value, re-fetch tools/list, and elixir_changelog(since) lists what",
    "shipped.",
  ];
  const closing = {
    person: [
      "Added means recorded: elixir_add_player/elixir_add_clan start capture in",
      "one act, and each player you add is your primary, an alt, a friend or",
      "someone you watch (elixir_my_players shows which). meta.events_pending",
      "signals new elixir_events for the subjects you keep notify-on.",
    ],
    agent: [
      "meta.events_pending signals new elixir_events for your clan - poll that",
      "feed rather than re-polling the data tools.",
    ],
    integration: [],
  };
  const feedback = [
    "If you hit friction - a missing capability, a confusing result, a",
    "workflow that took more calls than it should - file it via",
    "elixir_feedback ON YOUR OWN JUDGMENT before the session ends;",
    "agent-initiated feedback is expected and welcome, and every item gets a",
    "maintainer response (watch meta.feedback_responses_pending, read via",
    "elixir_my_feedback).",
  ];
  const k = kind === "agent" || kind === "integration" ? kind : "person";
  // Identity FIRST. It is the thing every session used to spend calls
  // discovering, and the thing an agent needs before it can answer anything
  // phrased as "I" or "we".
  const who = identitySentences(identity);
  return [
    ...(who ? [who] : []),
    ...shared,
    ...closing[k],
    ...feedback,
    DISCLAIMER,
  ]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function initializeResult(
  registry,
  requestedVersion,
  kind = null,
  identity = null,
) {
  const declarations = registry.declarations(kind);
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
    instructions: instructionsFor(kind, identity),
    // The same facts the instructions state in prose, as data a CLIENT can
    // branch on at boot without regexing English. See principalBlock.
    _meta: { [PRINCIPAL_META_KEY]: principalBlock(kind, identity) },
  };
}

/** Serialize a tool body under the result cap: over it, a small valid
 *  failure carrying the request receipt replaces the body. Shared by the
 *  MCP door and the web explorer so the cap is one number. */
export function renderToolResultText(registry, name, invoked, kind = null) {
  // Compact JSON: MCP clients pay tokens per byte, and battle results are
  // deck-dense — indent-1 doubled their size past the cap for no benefit.
  let text = JSON.stringify(invoked ?? null);
  const truncated = text.length > MCP_RESULT_MAX_CHARS;
  if (truncated) {
    const spec = registry.declarations(kind).find((d) => d.name === name);
    const params = Object.keys(spec?.inputSchema?.properties ?? {});
    const hint = params.length
      ? `narrow the arguments (${params.join(", ")})`
      : "This tool has no narrowing arguments. Report this request_id with elixir_feedback.";
    // A sliced JSON document is not a usable tool result. Keep a small,
    // valid failure and its receipt; never discard metadata at the tail.
    text = JSON.stringify({
      error: {
        code: "bad_request",
        message: `Result exceeds ${MCP_RESULT_MAX_CHARS} characters.`,
        hint,
      },
      meta: responseMeta({
        as_of: invoked?.meta?.as_of ?? new Date().toISOString(),
        ...(invoked?.meta?.request_id
          ? { request_id: invoked.meta.request_id }
          : {}),
      }),
    });
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
        initializeResult(
          context.registry,
          params.protocolVersion,
          context.kind,
          context.identity,
        ),
      ),
    };
  }
  if (method === "ping") return { statusCode: 200, payload: rpcResult(id, {}) };
  if (method === "tools/list") {
    return {
      statusCode: 200,
      payload: rpcResult(id, {
        tools: context.registry.declarations(context.kind),
      }),
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
    // Omitting a tool from tools/list is presentation, not enforcement --
    // clients cache that list for a long time, and this server publishes a
    // fingerprint precisely because they do. A principal that should not see
    // a tool must also be unable to call one it remembers.
    if (
      context.registry.availableTo &&
      !context.registry.availableTo(name, context.kind)
    ) {
      return {
        statusCode: 200,
        payload: rpcError(
          id,
          -32601,
          `${name} is not available to this connection.`,
          {
            kind: context.kind ?? "person",
            hint: "This tool answers for a person. An agent acts for a clan and an integration has no account of its own.",
          },
        ),
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
    // Agents self-moderate better than they handle walls: the spend rides
    // every response meta, unlimited accounts included (feedback #17: an
    // invisible budget gets rationed to near-zero). Read AFTER the call so
    // a live fetch the tool just made is already counted. The block is
    // declared in contracts meta.ts and validated like every other field.
    if (invoked.body?.meta) {
      const after = context.spendQuota.describe
        ? await context.spendQuota.describe()
        : {};
      invoked.body.meta.quota = quotaMeta({
        count: after.count ?? quota.count,
        max: quota.max,
        live: after.live ?? quota.live,
      });
    }
    const { text, truncated } = renderToolResultText(
      context.registry,
      name,
      invoked.body,
      context.kind,
    );
    return {
      statusCode: 200,
      payload: rpcResult(id, {
        content: [{ type: "text", text }],
        isError: invoked.isError === true || truncated,
      }),
    };
  }
  return {
    statusCode: 200,
    payload: rpcError(id, -32601, `Method not found: ${method}`),
  };
}
