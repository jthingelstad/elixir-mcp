/**
 * The closed error taxonomy — DESIGN §3 contract discipline.
 *
 * Every tool failure maps to exactly one of these codes; raw upstream
 * errors, SQL errors, and CR API 404s never cross the tool boundary.
 */

export const ERROR_CODES = [
  "invalid_tag", // input failed tag normalization
  "not_entitled", // caller lacks entitlement to the subject (DESIGN §4.2)
  "not_recorded", // subject is valid but has no recording
  "not_found", // subject unknown to us and to the live API
  "quota_exceeded", // per-account quota or rate limit hit (JSON-RPC -32029)
  "live_unavailable", // the live lane is not configured, or the fetched payload was rejected at admission
  "live_pending", // live: true asked for a fresh read and none was in hand; a fetch is queued, call again in retry_after_s (1.7.0)
  "bad_request", // structurally invalid input other than tags
  "no_subject", // nothing to answer about: no default player, an unmapped on_behalf_of, or a clanless agent (1.0.0)
  "result_too_large", // the request was fine; the result exceeded the delivery cap - narrow the arguments (1.0.0)
  "query_timeout", // analytical work exceeded its cancellable query budget; retry or narrow the window (3.2.0)
  "internal", // the server failed, not the arguments: retrying the same call is reasonable, and the request_id is what to report (3.13.0)
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * What kind of thing an error is, beside which (3.18.0; review
 * 2026-09-19 Part 3.2): the machine-readable answer to "call again",
 * "fix the call", "there is nothing to answer about", "the server
 * failed" or "you are out of budget", so a consumer never derives it
 * from the code list. Every code has exactly one class.
 *
 *   retry    not a failure of the call: call again (live_pending after
 *            retry_after_s; query_timeout after a few seconds or with a
 *            narrower window)
 *   input    the call is wrong as sent: a tag, an argument, a size
 *   subject  the call is fine, there is nothing to answer about: unknown,
 *            unrecorded, not entitled, no default subject
 *   server   the server failed; the request_id is what to report
 *   budget   a quota or the live lane's ceiling
 */
export const ERROR_CLASSES = [
  "retry",
  "input",
  "subject",
  "server",
  "budget",
] as const;
export type ErrorClass = (typeof ERROR_CLASSES)[number];

export const ERROR_CLASS: Record<ErrorCode, ErrorClass> = {
  invalid_tag: "input",
  not_entitled: "subject",
  not_recorded: "subject",
  not_found: "subject",
  quota_exceeded: "budget",
  live_unavailable: "server",
  live_pending: "retry",
  bad_request: "input",
  no_subject: "subject",
  result_too_large: "input",
  query_timeout: "retry",
  internal: "server",
};

export interface ToolError {
  code: ErrorCode;
  /** The code's class (3.18.0): retry | input | subject | server | budget. */
  class?: ErrorClass;
  message: string;
  hint?: string;
  /** live_pending: seconds until the queued read is expected in hand (3.14.0). */
  retry_after_s?: number;
}

/** JSON-RPC error code for quota exhaustion (librarian's convention). */
export const JSONRPC_QUOTA_EXCEEDED = -32029;

export function toolError(
  code: ErrorCode,
  message: string,
  hint?: string,
): ToolError {
  const cls = ERROR_CLASS[code];
  return hint === undefined
    ? { code, class: cls, message }
    : { code, class: cls, message, hint };
}
