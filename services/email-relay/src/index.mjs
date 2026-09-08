/** Lambda entrypoint: the non-VPC relay — JMAP email, Tinylytics
 *  pings, and Buttondown mailing-list enrollment. */

import { createHash } from "node:crypto";
import { makeJmapSender } from "./jmap.mjs";
import { makeHandler } from "./handler.mjs";

/** Server-side Tinylytics events (Jamie, 2026-09-05): the VPC Lambdas
 *  enqueue, this relay posts — one batch call per SQS batch. Values
 *  carry tool names and status classes only, never user text. */
function makeTinylyticsTracker({ token, siteId }) {
  if (!token || !siteId) return null;
  return async (events) => {
    const res = await fetch(
      `https://tinylytics.app/api/v1/sites/${siteId}/events/batch`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          // Cloudflare rejects agent-less requests.
          "User-Agent": "elixir-mcp-relay",
        },
        body: JSON.stringify(
          events.map((e) => ({
            event: e.event,
            ...(e.value ? { value: e.value } : {}),
          })),
        ),
        // A hung analytics endpoint must never delay the emails that
        // share this batch (review item 1).
        signal: AbortSignal.timeout(3_000),
      },
    );
    if (!res.ok) throw new Error(`tinylytics ${res.status}`);
  };
}

/**
 * Server-side page views (2026-09-08).
 *
 * The signed-in application deliberately loads NO third-party script: issue
 * #25 removed the analytics tag from it because that code ran on /account and
 * /admin inside the session's own origin, where an HttpOnly cookie stops it
 * reading the cookie but not from making authenticated same-origin requests
 * with the user's authority.
 *
 * Measuring the app therefore goes the long way round: the app tells OUR api
 * that a route was viewed, that enqueues here, and this posts the hit. The
 * script never enters the session origin, and no account travels with the
 * view — a path and a coarse visitor id, nothing else.
 */
function makeTinylyticsHitter({ token, siteId }) {
  if (!token || !siteId) return null;
  return async (hits) => {
    for (const hit of hits) {
      const res = await fetch(
        `https://tinylytics.app/api/v1/sites/${siteId}/hits`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": "elixir-mcp-relay",
          },
          body: JSON.stringify({
            path: hit.path,
            ...(hit.visitor_id ? { visitor_id: hit.visitor_id } : {}),
            ...(hit.country ? { country: hit.country } : {}),
          }),
          signal: AbortSignal.timeout(3_000),
        },
      );
      if (!res.ok) throw new Error(`tinylytics hit ${res.status}`);
    }
  };
}

/** Buttondown answers 400 for both "you already have this address" and
 *  "this request is wrong". Treating the whole status as success (as we
 *  did) made a validation error or a schema change look like a healthy
 *  enrollment, and nothing anywhere would say otherwise. Read the code:
 *  an existing address is the benign one, everything else throws so it
 *  lands in the log. Unrecognised shapes throw too — a mystery 400 is
 *  worth a log line, and enrollment is best-effort either way. */
const BUTTONDOWN_EXISTS_CODES = new Set([
  "email_already_exists",
  "subscriber_already_exists",
  "duplicate",
]);

async function buttondownExists(res) {
  let body;
  try {
    body = await res.json();
  } catch {
    return false;
  }
  const code = String(body?.code ?? "");
  if (BUTTONDOWN_EXISTS_CODES.has(code)) return true;
  // Buttondown has moved this wording before; the code is the contract
  // and this is only a backstop for a renamed one.
  return /already\s+(exists|subscribed)/i.test(`${code} ${body?.detail ?? ""}`);
}

/** Buttondown enrollment (Jamie, 2026-09-05 — Drop's mailing-list
 *  model, written fresh with services/api/src/buttondown.ts open):
 *  idempotent POST. An EXISTING address — including an unsubscribed one
 *  — is left untouched, so an unsubscribe is never overridden. Only a
 *  login whose account opted in ever reaches here (issue #27).
 *  Newsletter selection rides the token (set BUTTONDOWN_NEWSLETTER_ID
 *  only for a multi-newsletter key). */
export function makeButtondownEnroller({
  token,
  newsletterId = null,
  fetchImpl = fetch,
}) {
  if (!token) return null;
  return async (email) => {
    const idem = createHash("sha256").update(email.toLowerCase()).digest("hex");
    const res = await fetchImpl("https://api.buttondown.com/v1/subscribers", {
      method: "POST",
      headers: {
        Authorization: `Token ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "elixir-mcp-relay",
        "X-Idempotency-Key": `elixir-mcp-login-${idem}`,
        ...(newsletterId ? { "Buttondown-Context": newsletterId } : {}),
      },
      body: JSON.stringify({
        email_address: email,
        type: "regular",
        metadata: { source: "elixir-mcp-login" },
      }),
      signal: AbortSignal.timeout(3_000),
    });
    if (res.ok) return;
    if (res.status === 400 && (await buttondownExists(res))) return;
    throw new Error(`buttondown ${res.status}`);
  };
}

export const handler = makeHandler({
  send: makeJmapSender({
    token: process.env.JMAP_TOKEN,
    fromEmail: process.env.FROM_EMAIL ?? "elixir@poapkings.com",
  }),
  track: makeTinylyticsTracker({
    token: process.env.TINYLYTICS_API_TOKEN,
    siteId: process.env.TINYLYTICS_SITE_ID,
  }),
  hit: makeTinylyticsHitter({
    token: process.env.TINYLYTICS_API_TOKEN,
    siteId: process.env.TINYLYTICS_SITE_ID,
  }),
  enroll: makeButtondownEnroller({
    token: process.env.BUTTONDOWN_API_TOKEN,
    newsletterId: process.env.BUTTONDOWN_NEWSLETTER_ID || null,
  }),
});
