/** Lambda entrypoint: the non-VPC relay — JMAP email + Tinylytics pings. */

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
      },
    );
    if (!res.ok) throw new Error(`tinylytics ${res.status}`);
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
});
