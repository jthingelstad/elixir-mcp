/**
 * One line per auth decision, on stdout, as JSON.
 *
 * Written because an authentication failure used to leave NO trace anywhere.
 * Two incidents on 2026-09-09 made the case: a rotated key took a Discord bot
 * offline and the console showed an agent that looked merely quiet, because a
 * 401 is refused before anything is audited; and an OAuth sign-in code was
 * rejected repeatedly with a message that merged seven causes, so diagnosing
 * it meant reading a screen recording frame by frame.
 *
 * WHAT NEVER GOES IN: no codes, no tokens, no raw email addresses, no PKCE
 * verifiers. An email is identified by the first 8 hex of the hash we already
 * store, which is enough to follow one person through one flow and useless for
 * anything else. `mcp_call_audit` remains the durable record of successful
 * work; this is the operational trail for the calls that never got that far.
 */

import { createHash } from "node:crypto";

export function emailRef(emailHash) {
  return typeof emailHash === "string" ? emailHash.slice(0, 8) : null;
}

/**
 * A stable, non-reversible handle for a presented credential, so repeated
 * failures from one dead client are distinguishable from a spray of bad keys.
 * Never the credential, and never enough of it to be one.
 */
export function credentialRef(presented) {
  if (typeof presented !== "string" || presented.length === 0) return null;
  return createHash("sha256").update(presented).digest("hex").slice(0, 8);
}

export function authLog(event, fields = {}) {
  const line = { at: new Date().toISOString(), auth: event };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    line[key] = value;
  }
  // JSON on one line: CloudWatch Logs Insights can query it, and a human
  // tailing the log can still read it.
  console.log(JSON.stringify(line));
}
