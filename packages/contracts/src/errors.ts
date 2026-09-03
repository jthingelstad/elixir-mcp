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
  "live_unavailable", // live-lane fetch timed out or no gateway available
  "bad_request", // structurally invalid input other than tags
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ToolError {
  code: ErrorCode;
  message: string;
  hint?: string;
}

/** JSON-RPC error code for quota exhaustion (librarian's convention). */
export const JSONRPC_QUOTA_EXCEEDED = -32029;

export function toolError(
  code: ErrorCode,
  message: string,
  hint?: string,
): ToolError {
  return hint === undefined ? { code, message } : { code, message, hint };
}
