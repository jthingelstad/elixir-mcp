/**
 * The audited tool invoker: every call — success or structured failure —
 * lands one bounded mcp_call_audit row (§11.3, the tuning loop's
 * evidence). ToolFailure renders as {error: {code, message, hint}} with
 * isError; unexpected errors render opaque (no internals cross the
 * boundary) and still audit.
 */

import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { responseMeta } from "@elixir-mcp/contracts";
import { ToolFailure } from "./tools.mjs";
import { pendingHints } from "./tools/shared.mjs";
import { MCP_RESULT_MAX_CHARS } from "./protocol.mjs";
import { captureCall } from "./capture.mjs";

const MAX_AUDIT_ARG_BYTES = 4000;
const MAX_ON_BEHALF_OF_CHARS = 200;

/** Flipped after the first call this sandbox serves. A Lambda module is
 *  evaluated once per sandbox, so "first invocation since load" IS the
 *  cold start, and it is what explains the latency outliers (review 4.2). */
let coldStart = true;

/** Nothing in the tool surface is named any of these, and nothing
 *  should be: an audit row is evidence, not a place for a credential to
 *  turn up because some future tool took one as an argument. Checked by
 *  key name before anything is serialized. */
const REDACTED_KEYS =
  /^(token|access_token|refresh_token|id_token|secret|client_secret|password|passwd|authorization|bearer|api_?key|credential|code|code_verifier|session|private_key)$/i;

function redactArgs(value) {
  if (Array.isArray(value)) return value.map(redactArgs);
  if (value === null || typeof value !== "object") return value;
  const out = {};
  for (const [k, v] of Object.entries(value))
    out[k] = REDACTED_KEYS.test(k) ? "[redacted]" : redactArgs(v);
  return out;
}

/**
 * Bound the arguments to something that is ALWAYS valid jsonb.
 *
 * This used to be JSON.stringify(args).slice(0, 4000), which cuts
 * wherever 4,000 characters happen to land — usually mid-string or
 * mid-object. Postgres rejected the fragment, the insert threw, and the
 * catch below swallowed it, so a caller could pick an argument length
 * that made its own audit row disappear (issue #30).
 *
 * Oversized calls keep as much as fits rather than collapsing to a
 * hash: top-level fields are kept in order while they fit, and the
 * envelope names what was dropped and pins the whole original with a
 * digest, so two identical oversized calls are still recognisable as
 * the same call.
 */
export function boundedArgs(args) {
  const source = redactArgs(args ?? {});
  const whole = JSON.stringify(source ?? {});
  const bytes = Buffer.byteLength(whole);
  if (bytes <= MAX_AUDIT_ARG_BYTES) return source ?? {};

  const digest = createHash("sha256").update(whole).digest("hex");
  const envelope = {
    truncated: true,
    original_bytes: bytes,
    sha256: digest,
    dropped_keys: [],
  };
  // An oversized array or scalar has no fields to keep - the envelope
  // alone is the record, and it is still valid jsonb.
  if (source === null || typeof source !== "object" || Array.isArray(source))
    return { _audit: envelope };

  const kept = {};
  const dropped = [];
  // Reserve room for the envelope itself so the result cannot exceed
  // the budget by describing how it exceeded the budget.
  let budget = MAX_AUDIT_ARG_BYTES - 512;
  for (const [k, v] of Object.entries(source ?? {})) {
    const cost = Buffer.byteLength(JSON.stringify({ [k]: v })) + 1;
    if (cost <= budget) {
      kept[k] = v;
      budget -= cost;
    } else {
      dropped.push(k);
    }
  }
  return {
    ...kept,
    _audit: { ...envelope, dropped_keys: dropped.slice(0, 32) },
  };
}

/**
 * One mcp_call_audit row. Every column after oauth_family_id is
 * additive (0063) and NULL when not measured, so a row written by the
 * refusal hook (no tool ran, nothing to time) and a row written by the
 * invoker share this one insert. The first three positions are pinned
 * by tests: account_id, token_id, request_id.
 */
export async function auditRow(
  db,
  {
    accountId,
    tokenId,
    requestId,
    surface,
    tool,
    args,
    startedAt,
    resultBytes,
    truncated,
    errorCode,
    viewerIp,
    viewerCountry,
    clientName,
    oauthFamilyId,
    captured = false,
    timings = {},
    coldStart: cold = null,
    principalKind = null,
    onBehalfOf = null,
    rpcErrorCode = null,
  },
) {
  try {
    await db.query(
      `insert into mcp_call_audit (account_id, token_id, request_id, surface, tool, args, duration_ms, result_bytes, truncated, error_code, viewer_ip, viewer_country, client_name, oauth_family_id,
         created_at, captured, db_ms, db_queries, live_wait_ms, serialize_ms, cold_start, principal_kind, on_behalf_of, rpc_error_code)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)`,
      [
        accountId,
        tokenId ?? null,
        requestId ?? null,
        surface,
        tool,
        JSON.stringify(boundedArgs(args)),
        Date.now() - startedAt,
        resultBytes ?? null,
        truncated ?? false,
        errorCode ?? null,
        viewerIp ?? null,
        viewerCountry ?? null,
        clientName ?? null,
        oauthFamilyId ?? null,
        // The call's own start, not the insert's: the capture key is
        // partitioned by this day and the reader rebuilds it from
        // created_at, so the two must come from the same clock reading.
        new Date(startedAt).toISOString(),
        captured === true,
        timings.db_ms ?? null,
        timings.db_queries ?? null,
        timings.live_wait_ms ?? null,
        timings.serialize_ms ?? null,
        cold,
        principalKind,
        onBehalfOf,
        rpcErrorCode,
      ],
    );
  } catch (err) {
    // Telemetry must never break serving (house rule) — but a durable
    // audit that failed is itself the thing worth knowing, and this
    // used to be a silent hole. Say so, and keep serving.
    console.error("audit_write_failed", tool, surface, err?.message);
  }
}

/** The delegated id as the caller gave it, for the census; bounded so a
 *  hostile argument cannot grow the row. */
export function onBehalfOfOf(args) {
  const v = args?.on_behalf_of ?? args?.segment?.on_behalf_of ?? null;
  if (v === null || v === undefined) return null;
  return String(v).slice(0, MAX_ON_BEHALF_OF_CHARS);
}

/**
 * The tool's database, timed. One client is one connection and pg
 * serialises whatever it is sent (docs/ENGINEERING.md), so the sum of
 * query wall time is exact rather than an estimate. A Proxy over the
 * shared client rather than a mutation of it: the invoker's own audit
 * insert and the pending-hints read go to the untimed client, so
 * db_ms is the TOOL's work and nothing else.
 */
export function timedDb(db, t) {
  return new Proxy(db, {
    get(target, prop) {
      if (prop !== "query") {
        const v = target[prop];
        return typeof v === "function" ? v.bind(target) : v;
      }
      return async (...a) => {
        const t0 = performance.now();
        try {
          return await target.query(...a);
        } finally {
          t.db_ms += performance.now() - t0;
          t.db_queries += 1;
        }
      };
    },
  });
}

/** The live lane, timed: how long the call sat waiting on a collector.
 *  null until the first live call, so "no live fetch" and "a live fetch
 *  that returned at once" stay distinguishable. */
function timedLive(live, t) {
  return async (...a) => {
    const t0 = performance.now();
    try {
      return await live(...a);
    } finally {
      t.live_wait_ms = (t.live_wait_ms ?? 0) + (performance.now() - t0);
    }
  };
}

const METRICS_NAMESPACE = "ElixirMCP/Tools";

/**
 * One CloudWatch EMF line per call (services/scheduler/src/metrics.mjs is
 * the pattern: the function runs in a NAT-free VPC with no CloudWatch
 * endpoint, so the metric rides the log-delivery path and can never
 * block a call). Emitted BOTH with the Tool dimension and without, so
 * the per-tool series exist for a dashboard and the alarm
 * (ToolLatencyP95Alarm) watches the one undimensioned p95.
 */
export function toolEmf(
  { tool, durationMs, dbMs, resultBytes, error },
  now = Date.now(),
) {
  return JSON.stringify({
    _aws: {
      Timestamp: now,
      CloudWatchMetrics: [
        {
          Namespace: METRICS_NAMESPACE,
          Dimensions: [["Tool"], []],
          Metrics: [
            { Name: "DurationMs", Unit: "Milliseconds" },
            { Name: "DbMs", Unit: "Milliseconds" },
            { Name: "ResultBytes", Unit: "Bytes" },
            { Name: "Errors", Unit: "Count" },
          ],
        },
      ],
    },
    Tool: tool,
    DurationMs: durationMs,
    DbMs: dbMs ?? 0,
    ResultBytes: resultBytes ?? 0,
    Errors: error ? 1 : 0,
  });
}

/**
 * Puts the request id where the caller will actually see it.
 *
 * Tools build their own envelope with responseMeta(), so the id is stamped
 * here rather than threaded through thirty handlers — the invoker is the one
 * place every call already passes through. A body without a meta envelope is
 * left alone: inventing one would produce an envelope missing the fields the
 * contract says it always has, which is worse than an unjoinable response.
 */
function stampRequestId(body, requestId) {
  if (body && typeof body === "object" && !Array.isArray(body) && body.meta) {
    body.meta.request_id = requestId;
  }
  return body;
}

export function makeInvoker({
  db,
  account,
  registry,
  live = null,
  surface = "mcp",
  viewerIp = null,
  viewerCountry = null,
  clientName = null,
  oauthFamilyId = null,
  track = null,
  notifyOwner = null,
  /** { s3, bucket } from capture.mjs makeCaptureStore(); null = no capture. */
  capture = null,
  /** Where the EMF line goes; null = no metrics (tests, the web explorer). */
  emitMetrics = null,
}) {
  const principalKind = account.kind ?? "person";
  return async function invokeTool(name, args, { finalizeMeta = null } = {}) {
    const startedAt = Date.now();
    // Minted before the tool runs so the audit row and the caller's copy are
    // the same value even when the tool throws.
    const requestId = randomUUID();
    const tokenId = account.tokenId ?? null;
    const cold = coldStart;
    coldStart = false;
    const timings = {
      db_ms: 0,
      db_queries: 0,
      live_wait_ms: null,
      serialize_ms: null,
    };
    // Ambient product signal (Tinylytics): tool name only, never args.
    // Fired AFTER the tool runs (finally) so the ping's SQS round-trip
    // never sits in front of the answer (review item 1).
    const ping = async () => {
      if (!track) return;
      try {
        await track(
          surface === "web" ? "explore.tool_call" : "mcp.tool_call",
          name,
        );
      } catch {
        // Analytics must never break serving (house rule).
      }
    };
    // What the caller gets, and what the row says about it. Composed in
    // the try/catch; everything that records it runs in the finally, so
    // capture and audit are behind the answer, never in front of it.
    let outcome;
    try {
      const body = await registry.invoke(
        name,
        {
          db: timedDb(db, timings),
          account,
          live: live ? timedLive(live, timings) : null,
          notifyOwner,
        },
        args,
      );
      // The two pending hints ride EVERY response (review 4.1): they used
      // to ride only the tools that built a full envelope, so the consumer
      // whose one regular call is elixir_events never saw
      // feedback_responses_pending and re-read its ledger on every tick.
      if (body && typeof body === "object" && body.meta) {
        const hints = await pendingHints(db, account);
        for (const [k, v] of Object.entries(hints)) body.meta[k] = v;
      }
      const s0 = performance.now();
      const resultBytes = JSON.stringify(body).length;
      timings.serialize_ms = performance.now() - s0;
      outcome = {
        body: stampRequestId(body, requestId),
        isError: false,
        resultBytes,
        // Mirror the protocol renderer's condition: auditing runs
        // before rendering, so compute rather than observe (sol-6 F8).
        truncated: surface !== "web" && resultBytes > MCP_RESULT_MAX_CHARS,
      };
    } catch (err) {
      if (err instanceof ToolFailure) {
        outcome = {
          body: {
            error: {
              code: err.code,
              message: err.message,
              ...(err.hint ? { hint: err.hint } : {}),
            },
            meta: responseMeta({
              as_of: new Date().toISOString(),
              request_id: requestId,
            }),
          },
          isError: true,
          errorCode: err.code,
        };
      } else {
        // Opaque to the caller, never opaque to the operator: the audit row
        // says "internal" and this line says what actually broke.
        console.error(
          "tool_failed_unexpectedly",
          name,
          requestId,
          err?.message,
        );
        outcome = {
          body: {
            error: {
              code: "bad_request",
              message: `Tool ${name} failed unexpectedly.`,
            },
            meta: responseMeta({
              as_of: new Date().toISOString(),
              request_id: requestId,
            }),
          },
          isError: true,
          errorCode: "internal",
        };
      }
    } finally {
      // The protocol layer stamps meta.quota (the after-the-call balance)
      // through this hook BEFORE capture, so the captured response is the
      // one the client received, quota included.
      if (finalizeMeta && outcome?.body?.meta) {
        try {
          await finalizeMeta(outcome.body.meta);
        } catch (err) {
          console.error("finalize_meta_failed", name, err?.message);
        }
      }
      const rounded = {
        db_ms: Math.round(timings.db_ms),
        db_queries: timings.db_queries,
        live_wait_ms:
          timings.live_wait_ms === null
            ? null
            : Math.round(timings.live_wait_ms),
        serialize_ms:
          timings.serialize_ms === null
            ? null
            : Math.round(timings.serialize_ms),
      };
      // The body first (it is what the row points at), then the row.
      // The request goes through the same key-name redaction as the
      // bounded args: nothing in the surface takes a secret, and capture
      // must not be the place one turns up.
      const captured = await captureCall({
        ...(capture ?? {}),
        requestId,
        at: startedAt,
        request: { tool: name, arguments: redactArgs(args ?? {}) },
        response: outcome.body,
        timings: { ...rounded, cold_start: cold },
        meta: {
          surface,
          principal_kind: principalKind,
          client_name: clientName,
        },
      });
      await auditRow(db, {
        viewerIp,
        viewerCountry,
        clientName,
        oauthFamilyId,
        accountId: account.accountId,
        tokenId,
        requestId,
        surface,
        tool: name,
        args,
        startedAt,
        resultBytes: outcome.resultBytes,
        truncated: outcome.truncated,
        errorCode: outcome.errorCode,
        captured,
        timings: rounded,
        coldStart: cold,
        principalKind,
        onBehalfOf: onBehalfOfOf(args),
      });
      if (emitMetrics) {
        try {
          emitMetrics(
            `${toolEmf({
              tool: name,
              durationMs: Date.now() - startedAt,
              dbMs: rounded.db_ms,
              resultBytes: outcome.resultBytes,
              error: outcome.errorCode != null,
            })}\n`,
          );
        } catch {
          // A metric must never break serving.
        }
      }
      await ping();
    }
    return { body: outcome.body, isError: outcome.isError };
  };
}
