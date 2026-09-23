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
import {
  listResources,
  listResourceTemplates,
  readResource,
  listPrompts,
  getPrompt,
} from "./resources.mjs";

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
 * Identity first (the thing every session used to spend calls
 * discovering), then the conventions every tool follows - said once here
 * rather than in fifteen argument descriptions - then where to start and
 * where the manual is.
 */
function instructionsFor(kind, identity) {
  const conventions = [
    "Recorded Clash Royale history: battles, performance, snapshots, war,",
    "coverage; all recorded game data is readable by every account.",
    "CONVENTIONS. Omit player_tag to mean the caller (a person's primary",
    "player; on an agent connection, whoever on_behalf_of is mapped to via",
    "elixir_identify). Omit clan_tag to mean the recorded clan. The segment",
    "tools (battles_meta_decks, battles_meta_cards, battles_trends,",
    "cards_synergy, badges_*) take segment: 'mine' (your clan), 'corpus'",
    "(the whole recorded corpus, said on purpose) or {player_tag | clan_tag",
    "| collection}; segment is required: name a population, the corpus is",
    "never a default, and a corpus read carries a population block.",
    "Windows are from/to (ISO instants, or YYYY-MM-DD resolved in",
    "the account's timezone, or the call's timezone argument; a date-only",
    "`to` covers that whole day; the daily series floor an instant to its",
    "game day, the 10:00Z grid, and say so); days/weeks are sugar; season",
    "('current', 'previous', 2026-08 or 135) bounds one season on every",
    "windowed tool (the meta tools default to it). Every windowed response",
    "echoes applied.window with source argument, default, unbounded, fixed",
    "or season, the season it starts in and crosses (every season roll",
    "inside it; a note fires when one is).",
    "verbosity: 'compact' is the one size control, accepted on every tool",
    "(a tool with one size says so in a note and answers in full). Every",
    "response carries notes[] (one-sentence caveats to repeat) and docs (a",
    "page#section for elixir_docs). meta.freshness_seconds and",
    "meta.completeness_note say how current and complete an answer is;",
    "elixir_coverage says how complete a player's record is. game_clock says",
    "what season and war day it is. live: true (players_profile,",
    "clans_roster, war_current, battles_query, the board tools) serves a",
    "fresh read if in hand, otherwise answers from the record with",
    "live_status pending and retry_after_s to call again.",
    "All tags are CR tags like #20JJJ2CCRU.",
    "Every deck object carries archetype: say its label ('Royal Hogs bridge",
    "spam', 'Hog Rider cycle'), never eight card names; win_conditions,",
    "secondary_win_conditions and named_by say what the label rests on. A",
    "name a person uses (a family, a label, 'LavaLoon', '2.6 Hog') is the",
    "archetype argument on battles_meta_decks, battles_decks and cards_card,",
    "and cards_archetype resolves a name or names eight cards on its own.",
    "battles_meta_decks group_by 'archetype' is what a clan plays, with who",
    "plays each. A label is a noun, never a verdict: no matchups exist here.",
    "Tool schemas evolve: if serverInfo.version differs from your cached",
    "value, re-fetch tools/list; elixir_changelog(since) lists what shipped.",
    "The manual is elixir_docs (start with pages choosing-a-tool and",
    "glossary) and the same pages are resources at elixir://docs/<slug>.",
  ];
  const start = {
    person: [
      "START with players_summary for 'how am I doing', battles_performance",
      "for a window or a before/after, battles_decks for decks, and",
      "elixir_timeline for what happened (sessions, moments and an entry",
      "per player you track). Tracked means recorded:",
      "elixir_track_player / elixir_track_clan start capture in one act, and",
      "each player you track is your primary, an alt, a friend or someone you",
      "watch (elixir_my_players shows which). meta.timeline_pending signals",
      "new elixir_timeline for the subjects you keep notify-on.",
    ],
    agent: [
      "START with clans_roster (once per run; verbosity 'compact' for a",
      "count), war_current (decks_today is who still has decks) and",
      "elixir_timeline as your own reader (reader: a short name for this",
      "consumer; its pointer moves only when you mark): the clan's items in",
      "order, then its entry. meta.timeline_pending (against the oldest",
      "named reader) and meta.feedback_responses_pending ride every",
      "response: poll the feed and elixir_my_feedback only when they say",
      "there is something new, never on a timer. Pass display_name beside",
      "an unmapped on_behalf_of and no_subject carries candidates[].",
      "'What decks do we play' is battles_meta_decks({ segment: 'mine',",
      "group_by: 'archetype' }); a deck named to a person passes fit_for.",
    ],
    integration: [],
  };
  const feedback = [
    "If you hit friction - a missing capability, a confusing result, a",
    "workflow that took more calls than it should - file it via",
    "elixir_send_feedback ON YOUR OWN JUDGMENT before the session ends;",
    "agent-initiated feedback is expected and welcome, and every item gets a",
    "maintainer response (watch meta.feedback_responses_pending, read via",
    "elixir_my_feedback).",
  ];
  const k = kind === "agent" || kind === "integration" ? kind : "person";
  const who = identitySentences(identity);
  return [
    ...(who ? [who] : []),
    ...conventions,
    ...start[k],
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
    const params = Object.keys(spec?.inputSchema?.properties ?? {});
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
            invoked?.applied?.verbosity
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

/**
 * One JSON-RPC message in, one HTTP-ready reply out.
 * context: { registry, spendQuota(), invokeTool(name, args), db? }
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
  // Resources and prompts: the documentation corpus, listed lazily by
  // clients and therefore reachable even when a cached tools/list is not.
  if (method === "resources/list") {
    return {
      statusCode: 200,
      payload: rpcResult(id, { resources: listResources() }),
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
      payload: rpcResult(id, { prompts: listPrompts() }),
    };
  }
  if (method === "prompts/get") {
    const prompt = getPrompt(params.name);
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
    return {
      statusCode: 200,
      payload: rpcResult(id, {
        content: [{ type: "text", text }],
        // The same JSON as data, for clients that read structuredContent
        // (2025-06-18); the text block stays for the rest.
        ...(body && typeof body === "object"
          ? { structuredContent: body }
          : {}),
        isError: invoked.isError === true || truncated,
      }),
    };
  }
  return {
    statusCode: 200,
    payload: rpcError(id, -32601, `Method not found: ${method}`),
  };
}
