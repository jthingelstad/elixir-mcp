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

/** Buttondown enrollment (Jamie, 2026-09-05 — Drop's mailing-list
 *  model, written fresh with services/api/src/buttondown.ts open):
 *  idempotent POST; HTTP 400 means the address exists — including
 *  unsubscribed — and is left untouched, so an unsubscribe is never
 *  overridden. Newsletter selection rides the token (set
 *  BUTTONDOWN_NEWSLETTER_ID only for a multi-newsletter key). */
function makeButtondownEnroller({ token, newsletterId = null }) {
  if (!token) return null;
  return async (email) => {
    const idem = createHash("sha256").update(email.toLowerCase()).digest("hex");
    const res = await fetch("https://api.buttondown.com/v1/subscribers", {
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
    if (res.ok || res.status === 400) return;
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
  enroll: makeButtondownEnroller({
    token: process.env.BUTTONDOWN_API_TOKEN,
    newsletterId: process.env.BUTTONDOWN_NEWSLETTER_ID || null,
  }),
});
