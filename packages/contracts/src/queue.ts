/**
 * Queue message contracts — the gateway <-> ingest seam (DESIGN §5.1).
 * Versioned like the tool contract: additive = fine, breaking = bump `v`.
 */

export interface CrJob {
  endpoint: string;
  /** Canonical entity key: a normalized tag, or 'GLOBAL'. */
  entity_key: string;
  lane: "live" | "bulk";
  /** Present on live-lane jobs so the MCP layer can await the receipt. */
  correlation_id?: string;
}

export interface CrResultMessage {
  v: 1;
  job: CrJob;
  gateway_id: string;
  /** ISO 8601 UTC; stable across SQS redeliveries — the idempotency key
   *  component (unique with gateway_id + endpoint + entity_key). */
  fetched_at: string;
  status: "ok" | "error";
  http_status?: number;
  /** Response body, gzipped then base64 (SQS 256KB cap; DESIGN §5.1). */
  body_gzip_b64?: string;
  error?: {
    kind: "transport" | "http" | "overflow" | "breaker";
    message?: string;
  };
}

/** Email queue message — VPC Lambdas enqueue, the non-VPC relay sends
 *  (DESIGN §7 NAT-free posture). Plaintext email address rides the queue
 *  (SSE-encrypted at rest) because the relay must address the mail. */
export interface EmailMessage {
  v: 1;
  kind: "login" | "welcome" | "owner_notify";
  to: string;
  /** login: the 6-digit code. */
  code?: string;
  /** login: the magic token for the link. */
  token?: string;
  /** login (oauth shell): client display name for the consent line. */
  client_name?: string;
  /** owner_notify: what happened. */
  note?: string;
}

const EMAIL_KINDS = new Set(["login", "welcome", "owner_notify"]);

export function validateEmailMessage(
  msg: unknown,
): { ok: true; msg: EmailMessage } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const m = msg as EmailMessage;
  if (typeof m !== "object" || m === null)
    return { ok: false, errors: [":not-an-object"] };
  if (m.v !== 1) errors.push("v:unsupported");
  if (!EMAIL_KINDS.has(m.kind as string)) errors.push("kind:invalid");
  if (typeof m.to !== "string" || !m.to.includes("@"))
    errors.push("to:invalid");
  if (m.kind === "login" && typeof m.code !== "string")
    errors.push("code:missing");
  return errors.length === 0 ? { ok: true, msg: m } : { ok: false, errors };
}

const LANES = new Set(["live", "bulk"]);
const STATUSES = new Set(["ok", "error"]);

export function validateResultMessage(
  msg: unknown,
): { ok: true; msg: CrResultMessage } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const m = msg as CrResultMessage;
  if (typeof m !== "object" || m === null)
    return { ok: false, errors: [":not-an-object"] };
  if (m.v !== 1) errors.push("v:unsupported");
  if (typeof m.job?.endpoint !== "string") errors.push("job.endpoint:missing");
  if (typeof m.job?.entity_key !== "string")
    errors.push("job.entity_key:missing");
  if (!LANES.has(m.job?.lane as string)) errors.push("job.lane:invalid");
  if (typeof m.gateway_id !== "string") errors.push("gateway_id:missing");
  if (
    typeof m.fetched_at !== "string" ||
    Number.isNaN(Date.parse(m.fetched_at))
  )
    errors.push("fetched_at:invalid");
  if (!STATUSES.has(m.status as string)) errors.push("status:invalid");
  if (m.status === "ok" && typeof m.body_gzip_b64 !== "string")
    errors.push("body_gzip_b64:missing");
  return errors.length === 0 ? { ok: true, msg: m } : { ok: false, errors };
}
