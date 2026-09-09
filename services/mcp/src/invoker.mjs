/**
 * The audited tool invoker: every call — success or structured failure —
 * lands one bounded mcp_call_audit row (§11.3, the tuning loop's
 * evidence). ToolFailure renders as {error: {code, message, hint}} with
 * isError; unexpected errors render opaque (no internals cross the
 * boundary) and still audit.
 */

import { createHash, randomUUID } from "node:crypto";
import { responseMeta } from "@elixir-mcp/contracts";
import { ToolFailure } from "./tools.mjs";
import { MCP_RESULT_MAX_CHARS } from "./protocol.mjs";

const MAX_AUDIT_ARG_BYTES = 4000;

/** Nothing in the tool surface is named any of these, and nothing
 *  should be: an audit row is evidence, not a place for a credential to
 *  turn up because some future tool took one as an argument. Checked by
 *  key name before anything is serialized. */
const REDACTED_KEYS =
  /^(token|secret|password|passwd|authorization|bearer|api_?key|credential|code|session)$/i;

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

async function audit(
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
  },
) {
  try {
    await db.query(
      `insert into mcp_call_audit (account_id, token_id, request_id, surface, tool, args, duration_ms, result_bytes, truncated, error_code, viewer_ip, viewer_country, client_name, oauth_family_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
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
      ],
    );
  } catch (err) {
    // Telemetry must never break serving (house rule) — but a durable
    // audit that failed is itself the thing worth knowing, and this
    // used to be a silent hole. Say so, and keep serving.
    console.error("audit_write_failed", tool, surface, err?.message);
  }
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
}) {
  return async function invokeTool(name, args) {
    const startedAt = Date.now();
    // Minted before the tool runs so the audit row and the caller's copy are
    // the same value even when the tool throws.
    const requestId = randomUUID();
    const tokenId = account.tokenId ?? null;
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
    try {
      const body = await registry.invoke(name, { db, account, live }, args);
      const resultBytes = JSON.stringify(body).length;
      await audit(db, {
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
        resultBytes,
        // Mirror the protocol renderer's condition: auditing runs
        // before rendering, so compute rather than observe (sol-6 F8).
        truncated: surface !== "web" && resultBytes > MCP_RESULT_MAX_CHARS,
      });
      return { body: stampRequestId(body, requestId), isError: false };
    } catch (err) {
      if (err instanceof ToolFailure) {
        await audit(db, {
          viewerIp,
          viewerCountry,
          clientName,
          accountId: account.accountId,
          tokenId,
          requestId,
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
            meta: responseMeta({
              as_of: new Date().toISOString(),
              request_id: requestId,
            }),
          },
          isError: true,
        };
      }
      // Opaque to the caller, never opaque to the operator: the audit row
      // says "internal" and this line says what actually broke.
      console.error("tool_failed_unexpectedly", name, requestId, err?.message);
      await audit(db, {
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
        errorCode: "internal",
      });
      return {
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
      };
    } finally {
      await ping();
    }
  };
}
