/**
 * The common meta envelope every tool response carries — docs/ENGINEERING.md.
 * "Is your data right/current" is a top-10 user question; the envelope is
 * the standing answer.
 */

import { CONTRACT_VERSION } from "./version.js";

export const DISCLAIMER =
  "This material is unofficial and is not endorsed by Supercell. For more " +
  "information see Supercell’s Fan Content Policy: " +
  "www.supercell.com/fan-content-policy.";

export interface ResponseMeta {
  /** When this answer was computed (ISO 8601 UTC). */
  as_of: string;
  /** Earliest stored history among the answer's player data sources, not continuous coverage. */
  recorded_since?: string;
  /** Start of the current active recording; history can predate it. */
  recording_active_since?: string;
  /** Oldest relevant source poll age. Null if any required source has never been polled. */
  freshness_seconds?: number | null;
  /** Individual source polls, so fresh profile data cannot disguise a stale battle log. */
  source_polls?: Record<
    string,
    { observed_at: string | null; freshness_seconds: number | null }
  >;
  /** Display timezone applied to local labels; stored timestamps remain UTC. */
  timezone_applied?: string;
  /** Honest caveat when capture is known incomplete. */
  completeness_note?: string;
  /** Maintainer replies to your feedback awaiting elixir_my_feedback. */
  feedback_responses_pending?: number;
  /** Unread push-lane events awaiting elixir_events. */
  events_pending?: number;
  /**
   * Identifies the mcp_call_audit row this response came from, so a reported
   * answer can be joined to the server's record of producing it. Stamped by
   * the invoker after the tool returns — tools never set it, which is why it
   * is optional here and present in practice.
   */
  request_id?: string;
  disclaimer: typeof DISCLAIMER;
  contract_version: typeof CONTRACT_VERSION;
}

export function responseMeta(
  fields: Omit<ResponseMeta, "disclaimer" | "contract_version">,
): ResponseMeta {
  const meta = {
    ...fields,
    disclaimer: DISCLAIMER,
    contract_version: CONTRACT_VERSION,
  };
  assertResponseMeta(meta);
  return meta;
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const utcTimestamp = (value: unknown): boolean =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) &&
  Number.isFinite(Date.parse(value));
const count = (value: unknown): boolean =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const age = (value: unknown): boolean => value === null || count(value);
const text = (value: unknown): boolean => typeof value === "string";

// Complete over keyof ResponseMeta: adding a field requires its runtime rule.
const checks: Record<keyof ResponseMeta, (value: unknown) => boolean> = {
  as_of: utcTimestamp,
  recorded_since: utcTimestamp,
  recording_active_since: utcTimestamp,
  freshness_seconds: age,
  source_polls: (value) =>
    object(value) &&
    Object.values(value).every(
      (poll) =>
        object(poll) &&
        (poll.observed_at === null || utcTimestamp(poll.observed_at)) &&
        age(poll.freshness_seconds) &&
        (poll.observed_at === null) === (poll.freshness_seconds === null),
    ),
  completeness_note: text,
  timezone_applied: text,
  feedback_responses_pending: count,
  events_pending: count,
  request_id: (value) =>
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    ),
  disclaimer: (value) => value === DISCLAIMER,
  contract_version: (value) => value === CONTRACT_VERSION,
};

/** Producer-side check: validate actual metadata, without printing its values.
 * This is not a client parser: future additive fields belong in this contract
 * before a server emits them. Optional means omitted, not null or undefined.
 */
export function assertResponseMeta(
  value: unknown,
): asserts value is ResponseMeta {
  if (!object(value)) throw new TypeError("Invalid response metadata");
  for (const required of ["as_of", "disclaimer", "contract_version"]) {
    if (!Object.hasOwn(value, required))
      throw new TypeError(`Missing meta.${required}`);
  }
  for (const [key, field] of Object.entries(value)) {
    if (
      !Object.hasOwn(checks, key) ||
      !checks[key as keyof ResponseMeta](field)
    )
      throw new TypeError(`Invalid meta.${key}`);
  }
}
