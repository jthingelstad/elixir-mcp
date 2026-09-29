/**
 * MCP protocol layer — librarian's pattern (its shipped lessons kept):
 * stateless streamable HTTP, one JSON-RPC message per POST; batching
 * rejected (removed in the 2025-06-18 revision); listChanged declared
 * true because the list DOES change across deploys and a stateless server
 * can never deliver the notification — serverInfo.version is the honest
 * cache key, changing exactly when the tool surface does; results capped
 * with a hint naming the tool's own parameters.
 *
 * 1.0.0: resources and prompts beside tools (resources.mjs), every tool
 * result also as structuredContent, an oversized result answered with
 * result_too_large rather than bad_request, and the opening instructions
 * carrying the canonical explanation of player_tag / on_behalf_of /
 * windows once, so the per-argument descriptions can be one line.
 */

import crypto from "node:crypto";
import { CONTRACT_VERSION, DISCLAIMER } from "@elixir-mcp/contracts";
import {
  identitySentences,
  principalBlock,
  PRINCIPAL_META_KEY,
} from "@elixir-mcp/tools/identity";
import { quotaMeta } from "@elixir-mcp/tools/quota";
import { renderToolResultText } from "@elixir-mcp/tools/result-text";
import {
  listResources,
  listResourceTemplates,
  readResource,
  listPrompts,
  getPrompt,
} from "./resources.mjs";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26"];
/** What a request without the header is taken to speak: the 2025-06-18
 *  transport's backwards-compatibility rule. Nothing this server sends
 *  differs between the two versions it supports. */
const ASSUMED_PROTOCOL_VERSION = "2025-03-26";

/**
 * The MCP-Protocol-Version header (2025-06-18, streamable HTTP): every
 * request after initialize carries the negotiated version. Absent, it is
 * taken as 2025-03-26; a value this server does not speak is refused with
 * HTTP 400, as the transport requires. `initialize` is exempt: its body
 * negotiates the version, and a client has none to send yet.
 */
export function requestProtocolVersion(header) {
  if (header === undefined || header === null || header === "")
    return { ok: true, version: ASSUMED_PROTOCOL_VERSION };
  const version = String(header).trim();
  return SUPPORTED_PROTOCOL_VERSIONS.includes(version)
    ? { ok: true, version }
    : { ok: false, version };
}
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

/** What Claude Code hands the model of `instructions`: the first 2,048
 *  characters and not one more (review 2026-09-27 §6.1: the brief ran
 *  about 4,500 and stopped mid-sentence, so START, the feedback line and
 *  half the rules never arrived). The brief is written to fit. */
export const INSTRUCTIONS_BUDGET = 2048;

/**
 * The opening brief, written for the principal actually connecting,
 * ordered by value so that a client which cuts it keeps the most:
 * identity (capped, identity.mjs), the one-line rules that change an
 * answer, START, the feedback line, then one pointer to the manual,
 * where the window grammar, verbosity and the response envelope are
 * spelled out (protocol#argument-conventions). A test renders a
 * 50-player, 10-clan identity and holds the whole brief under
 * INSTRUCTIONS_BUDGET.
 */
function instructionsFor(kind, identity) {
  const rules = [
    "segment is REQUIRED on battles_meta_decks, battles_meta_cards,",
    "battles_trends, cards_synergy, cards_card and badges_*: 'mine',",
    "'corpus' (on purpose) or {player_tag | clan_tag | collection}.",
    "Windows: from/to, days/weeks or season ('current', 'previous', 2026-08,",
    "135); applied.window says what was read. Name a deck by its archetype",
    "label ('Hog Rider cycle'), never eight cards; a label is not a verdict;",
    "cards_archetype resolves a name a person uses. A deck named to a person",
    "passes fit_for (their collection). Modes are different games: a rate",
    "with no mode pools them; pass mode for one. Repeat a response's",
    "notes[]. When serverInfo.version changes, re-fetch tools/list;",
    "elixir_changelog(since) says what shipped.",
  ];
  const start = {
    person: [
      "START: players_summary for 'how am I doing', battles_performance for",
      "a window or a before/after, battles_decks for decks, elixir_timeline",
      "for what happened; elixir_track_player / elixir_track_clan start",
      "recording someone. meta.timeline_pending means elixir_timeline has",
      "news.",
    ],
    agent: [
      "START: war_current (decks_today: who still has decks), elixir_timeline",
      "under your own reader name; poll it and elixir_my_feedback only when",
      "meta.timeline_pending or meta.feedback_responses_pending says so.",
      "display_name beside an unmapped on_behalf_of makes no_subject carry",
      "candidates[]. 'What decks do we play': battles_meta_decks({ segment:",
      "'mine', group_by: 'archetype' }).",
    ],
    integration: [],
  };
  const feedback = [
    "Hit friction (a missing capability, a confusing result, too many",
    "calls)? File elixir_send_feedback on your own judgment; every item is",
    "answered.",
  ];
  const manual = [
    "Manual: elixir_docs (choosing-a-tool, glossary; windows, verbosity and",
    "response fields: protocol#argument-conventions).",
  ];
  const k = kind === "agent" || kind === "integration" ? kind : "person";
  const render = (who) =>
    [
      ...(who ? [who] : []),
      ...rules,
      ...start[k],
      ...feedback,
      ...manual,
      DISCLAIMER,
    ]
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  // Every name while the whole brief fits; past the budget, the identity
  // counts instead of listing (elixir_my_players lists them all).
  const full = render(identitySentences(identity));
  return full.length <= INSTRUCTIONS_BUDGET
    ? full
    : render(identitySentences(identity, { compact: true }));
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
    capabilities: {
      tools: { listChanged: true },
      resources: { subscribe: false, listChanged: false },
      prompts: { listChanged: false },
    },
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

/**
 * One JSON-RPC message in, one HTTP-ready reply out.
 * context: { registry, spendQuota(), invokeTool(name, args), db?,
 *            protocolVersionHeader? }
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

  if (method !== "initialize") {
    const version = requestProtocolVersion(context.protocolVersionHeader);
    if (!version.ok)
      return {
        statusCode: 400,
        payload: rpcError(
          id ?? null,
          -32600,
          `Unsupported MCP-Protocol-Version: ${version.version.slice(0, 40)}.`,
          {
            supported: SUPPORTED_PROTOCOL_VERSIONS,
            hint: `Send the version initialize negotiated (${MCP_PROTOCOL_VERSION} unless you asked for ${SUPPORTED_PROTOCOL_VERSIONS.slice(1).join(", ")}), or omit the header.`,
          },
        ),
      };
  }
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
  // Resources and prompts: the documentation corpus, listed lazily by
  // clients and therefore reachable even when a cached tools/list is not.
  if (method === "resources/list") {
    return {
      statusCode: 200,
      payload: rpcResult(id, { resources: await listResources() }),
    };
  }
  if (method === "resources/templates/list") {
    return {
      statusCode: 200,
      payload: rpcResult(id, { resourceTemplates: listResourceTemplates() }),
    };
  }
  if (method === "resources/read") {
    const uri = String(params.uri ?? "");
    const found = await readResource(uri, { db: context.db ?? null });
    // A read of the corpus is audited like a call (3.18.0, review Part
    // 7.3): "nobody reads the resources" was a guess with no number.
    await context.auditRead?.("resources/read", { uri }, Boolean(found));
    if (!found) {
      return {
        statusCode: 200,
        payload: rpcError(id, -32002, `Resource not found: ${uri}`, {
          hint: "resources/list names every resource; pages are elixir://docs/<slug>.",
        }),
      };
    }
    return { statusCode: 200, payload: rpcResult(id, found) };
  }
  if (method === "prompts/list") {
    return {
      statusCode: 200,
      payload: rpcResult(id, { prompts: await listPrompts() }),
    };
  }
  if (method === "prompts/get") {
    const prompt = await getPrompt(params.name);
    await context.auditRead?.(
      "prompts/get",
      { name: String(params.name ?? "") },
      Boolean(prompt),
    );
    if (!prompt) {
      return {
        statusCode: 200,
        payload: rpcError(id, -32602, `Unknown prompt: ${params.name}`),
      };
    }
    return { statusCode: 200, payload: rpcResult(id, prompt) };
  }
  if (method === "tools/call") {
    const name = String(params.name ?? "");
    if (!context.registry.has(name)) {
      await context.auditRefusal?.(-32602, name, params.arguments);
      return {
        statusCode: 200,
        payload: rpcError(id, -32602, `Unknown tool: ${name}`, {
          hint: "tools/list names every tool; if this one shipped after your client cached the list, reconnect. elixir_changelog(since) says what moved.",
        }),
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
      await context.auditRefusal?.(-32601, name, params.arguments);
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
      await context.auditRefusal?.(
        MCP_QUOTA_ERROR_CODE,
        name,
        params.arguments,
      );
      return {
        statusCode: 200,
        payload: rpcError(
          id,
          MCP_QUOTA_ERROR_CODE,
          `Daily tool-call quota reached (${quota.max} per day). It resets at midnight UTC.`,
          {
            code: "quota_exceeded",
            hint: "Recorded-data reads are bounded only by this daily budget; elixir_docs({ page: 'limits' }) has the ladder, and running a collector earns credits.",
          },
        ),
      };
    }
    const args =
      params.arguments && typeof params.arguments === "object"
        ? params.arguments
        : {};
    // Agents self-moderate better than they handle walls: the spend rides
    // every response meta, unlimited accounts included (feedback #17).
    // Stamped through the invoker's finalizeMeta hook so the captured
    // response carries it too; read AFTER the call so a live fetch the
    // tool just made is already counted.
    const stampQuota = async (meta) => {
      const after = context.spendQuota.describe
        ? await context.spendQuota.describe()
        : {};
      meta.quota = quotaMeta({
        count: after.count ?? quota.count,
        max: quota.max,
        live: after.live ?? quota.live,
      });
    };
    const invoked = await context.invokeTool(name, args, {
      finalizeMeta: stampQuota,
    });
    if (invoked.body?.meta && !invoked.body.meta.quota)
      await stampQuota(invoked.body.meta);
    const { text, truncated, body } = renderToolResultText(
      context.registry,
      name,
      invoked.body,
      context.kind,
    );
    const isError = invoked.isError === true || truncated;
    return {
      statusCode: 200,
      payload: rpcResult(id, {
        content: [{ type: "text", text }],
        // The same JSON as data, for clients that read structuredContent
        // (2025-06-18); the text block stays for the rest. Never on an
        // error: the spec holds structuredContent to the tool's
        // outputSchema, which requires meta, notes and docs, and a strict
        // client (the reference SDK validates) would throw away exactly
        // the refusal whose hint matters (review 2026-09-27 §6.2). The
        // text block carries the same {error, meta}.
        ...(!isError && body && typeof body === "object"
          ? { structuredContent: body }
          : {}),
        isError,
      }),
    };
  }
  return {
    statusCode: 200,
    payload: rpcError(id, -32601, `Method not found: ${method}`),
  };
}
