/**
 * The common meta envelope every tool response carries — DESIGN §3.
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
  /** Recording start for the primary subject, if applicable. */
  recorded_since?: string;
  /** Age of the freshest underlying poll, in seconds. */
  freshness_seconds?: number;
  /** Honest caveat when capture is known incomplete (DESIGN §5.4). */
  completeness_note?: string;
  disclaimer: typeof DISCLAIMER;
  contract_version: typeof CONTRACT_VERSION;
}

export function responseMeta(
  fields: Omit<ResponseMeta, "disclaimer" | "contract_version">,
): ResponseMeta {
  return {
    ...fields,
    disclaimer: DISCLAIMER,
    contract_version: CONTRACT_VERSION,
  };
}
