/**
 * Queue message contracts — the gateway <-> ingest seam (DESIGN §5.1).
 * Versioned like the tool contract: additive = fine, breaking = bump `v`.
 */

export interface CrJob {
  endpoint: string;
  /** Canonical entity key: a normalized tag, or 'GLOBAL'. */
  entity_key: string;
  lane: 'live' | 'bulk';
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
  status: 'ok' | 'error';
  http_status?: number;
  /** Response body, gzipped then base64 (SQS 256KB cap; DESIGN §5.1). */
  body_gzip_b64?: string;
  error?: { kind: 'transport' | 'http' | 'overflow' | 'breaker'; message?: string };
}

const LANES = new Set(['live', 'bulk']);
const STATUSES = new Set(['ok', 'error']);

export function validateResultMessage(
  msg: unknown,
): { ok: true; msg: CrResultMessage } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const m = msg as CrResultMessage;
  if (typeof m !== 'object' || m === null) return { ok: false, errors: [':not-an-object'] };
  if (m.v !== 1) errors.push('v:unsupported');
  if (typeof m.job?.endpoint !== 'string') errors.push('job.endpoint:missing');
  if (typeof m.job?.entity_key !== 'string') errors.push('job.entity_key:missing');
  if (!LANES.has(m.job?.lane as string)) errors.push('job.lane:invalid');
  if (typeof m.gateway_id !== 'string') errors.push('gateway_id:missing');
  if (typeof m.fetched_at !== 'string' || Number.isNaN(Date.parse(m.fetched_at)))
    errors.push('fetched_at:invalid');
  if (!STATUSES.has(m.status as string)) errors.push('status:invalid');
  if (m.status === 'ok' && typeof m.body_gzip_b64 !== 'string')
    errors.push('body_gzip_b64:missing');
  return errors.length === 0 ? { ok: true, msg: m } : { ok: false, errors };
}
