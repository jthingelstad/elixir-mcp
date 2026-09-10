/**
 * One tool call, as the console's call record shows it: the audit row
 * with every 0063 column, the captured request and response read back
 * from the archive when the row says they landed, and the previous and
 * next call by the SAME credential so a reader can walk a session.
 *
 * Shared by the account route (own rows and owned agents' rows) and the
 * admin route (any row); the scope is the only thing that differs, so
 * it is the only thing the caller supplies. A captured body is served
 * through this handler under the session check that gated the row;
 * never a public URL.
 */

import { readCapture } from "../../mcp/src/capture.mjs";

const COLUMNS = `a.audit_id, a.account_id, a.token_id, a.request_id, a.surface, a.tool,
  a.args, a.duration_ms, a.result_bytes, a.truncated, a.error_code,
  a.viewer_country, a.client_name, a.oauth_family_id, a.created_at,
  a.captured, a.db_ms, a.db_queries, a.live_wait_ms, a.serialize_ms,
  a.cold_start, a.principal_kind, a.on_behalf_of, a.rpc_error_code,
  t.name as token_name`;

/**
 * The rows this reader may see. `ownerAccountId` null means every row
 * (admin); otherwise the account's own rows and those of the agents it
 * owns - the same slice /api/me/usage counts, because an agent's calls
 * are charged to its owner and the owner is who reads the record.
 */
function scopeSql(ownerAccountId, params) {
  if (!ownerAccountId) return "true";
  params.push(ownerAccountId);
  const n = params.length;
  return `(a.account_id = $${n} or a.account_id = any(coalesce(
            (select array_agg(account_id) from account where owned_by_account_id = $${n}),
            '{}'::uuid[])))`;
}

/** The credential predicate: a service token, an OAuth grant, or (for the
 *  console's explorer and anything else with neither) the account on the
 *  same surface. Prev/next walk within it. */
function credentialSql(row, params) {
  if (row.token_id != null) {
    params.push(row.token_id);
    return `a.token_id = $${params.length}`;
  }
  if (row.oauth_family_id) {
    params.push(row.oauth_family_id);
    return `a.oauth_family_id = $${params.length}`;
  }
  params.push(row.account_id, row.surface);
  return `a.account_id = $${params.length - 1} and a.token_id is null
          and a.oauth_family_id is null and a.surface = $${params.length}`;
}

export async function loadCallRecord(
  db,
  { requestId, ownerAccountId = null, capture = null },
) {
  const params = [requestId];
  const { rows } = await db.query(
    `select ${COLUMNS}
     from mcp_call_audit a
     left join service_token t on t.token_id = a.token_id
     where a.request_id = $1 and ${scopeSql(ownerAccountId, params)}
     limit 1`,
    params,
  );
  const row = rows[0];
  if (!row) return null;

  // Two small queries, not a window function over the whole log: the
  // credential index (0060) makes each a single index probe. The row's
  // own (created_at, audit_id) is read back INSIDE the query rather than
  // passed from JS: a Date carries milliseconds, timestamptz carries
  // microseconds, and the truncated value made the row its own "next".
  const before = [];
  const beforeSql = credentialSql(row, before);
  before.push(row.audit_id);
  const { rows: prev } = await db.query(
    `select a.request_id, a.created_at, a.tool from mcp_call_audit a
     where ${beforeSql} and a.request_id is not null
       and (a.created_at, a.audit_id) <
           (select o.created_at, o.audit_id from mcp_call_audit o where o.audit_id = $${before.length})
     order by a.created_at desc, a.audit_id desc limit 1`,
    before,
  );
  const after = [];
  const afterSql = credentialSql(row, after);
  after.push(row.audit_id);
  const { rows: next } = await db.query(
    `select a.request_id, a.created_at, a.tool from mcp_call_audit a
     where ${afterSql} and a.request_id is not null
       and (a.created_at, a.audit_id) >
           (select o.created_at, o.audit_id from mcp_call_audit o where o.audit_id = $${after.length})
     order by a.created_at asc, a.audit_id asc limit 1`,
    after,
  );

  const out = {
    call: {
      ...row,
      audit_id: undefined,
      // bigint arrives as a string from pg; the console shows a name.
      token_id: row.token_id == null ? null : String(row.token_id),
    },
    prev: prev[0] ?? null,
    next: next[0] ?? null,
    request: null,
    response: null,
    timings: null,
    captured_at: null,
  };
  delete out.call.audit_id;

  if (row.captured) {
    if (!capture) {
      out.capture_error = "unconfigured";
    } else {
      try {
        const body = await readCapture({
          ...capture,
          at: row.created_at,
          requestId,
        });
        out.request = body.request ?? null;
        out.response = body.response ?? null;
        out.timings = body.timings ?? null;
        out.captured_at = body.captured_at ?? null;
      } catch (err) {
        // The row said it landed and the archive disagrees: worth a log
        // line, never a 500 - the row itself is still the record.
        console.error("call_capture_read_failed", requestId, err?.message);
        out.capture_error = "unavailable";
      }
    }
  }
  return out;
}
