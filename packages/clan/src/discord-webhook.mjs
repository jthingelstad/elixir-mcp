/**
 * A clan's Discord webhook (2026-10-10): post a message and edit it, the
 * two calls the relay makes for Actions in Discord. Called only from the
 * relay, the one component with internet egress; Clan's VPC side reaches
 * it through the sealed bridge (`discord-bridge.mjs`).
 *
 * Every message is sent with no mentions allowed, so a member named
 * "@everyone" pings nobody, and with embeds suppressed (the links are
 * also wrapped in <>). A 429 is Discord saying it did NOT take the
 * message, so it is the one answer waited out and tried again here;
 * a timeout or lost connection leaves the outcome unknown and is never
 * retried, so a post is never made twice. Nothing logs the URL, whose
 * last part is the webhook's secret.
 */

/** A webhook address as Discord shows it, on any of its hostnames. */
export const WEBHOOK_URL =
  /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api(?:\/v\d{1,2})?\/webhooks\/([0-9]{15,25})\/([A-Za-z0-9_-]{40,120})$/;
const MESSAGE_ID = /^[0-9]{15,25}$/;

/**
 * The webhook a leader pasted, in its one canonical spelling, or null.
 * Query strings are refused rather than dropped: `?thread_id=` would
 * change where the messages go.
 */
export function parseWebhook(text) {
  const raw = String(text ?? "")
    .trim()
    .replace(/\/+$/, "");
  const m = WEBHOOK_URL.exec(raw);
  if (!m) return null;
  return {
    id: m[1],
    url: `https://discord.com/api/webhooks/${m[1]}/${m[2]}`,
  };
}

export const validMessageId = (id) => MESSAGE_ID.test(String(id ?? ""));

/** Discord's own error codes that mean the webhook or message is gone. */
const UNKNOWN_WEBHOOK = 10015;
const UNKNOWN_MESSAGE = 10008;

export function createDiscordWebhook({
  fetch = globalThis.fetch,
  timeoutMs = 10_000,
  pause = (ms) => new Promise((r) => setTimeout(r, ms)),
  /** How many 429s are waited out before the answer is "rate_limited". */
  retries = 3,
  /** The longest single wait Discord may ask for that is waited here. */
  maxWaitMs = 10_000,
} = {}) {
  async function call(method, url, body) {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetch(url, {
          method,
          headers: {
            "content-type": "application/json",
            "user-agent": "ElixirClan (https://elixir.poapkings.com/clan, 1)",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        return { ok: false, status: 0, code: "outcome_unknown" };
      }
      let json = null;
      try {
        json = await res.json();
      } catch {
        // An answer that is not JSON is judged by its status alone.
      }
      if (res.ok)
        return {
          ok: true,
          status: res.status,
          message_id: json?.id ?? null,
          name: json?.author?.username ?? null,
          channel_id: json?.channel_id ?? null,
        };
      if (res.status === 429) {
        const waitMs = Math.ceil(Number(json?.retry_after ?? 1) * 1000);
        if (attempt < retries && waitMs <= maxWaitMs) {
          await pause(Math.max(waitMs, 250));
          continue;
        }
        return { ok: false, status: 429, code: "rate_limited" };
      }
      const code =
        json?.code === UNKNOWN_WEBHOOK
          ? "webhook_gone"
          : json?.code === UNKNOWN_MESSAGE
            ? "message_gone"
            : res.status === 401 || res.status === 403
              ? "webhook_refused"
              : res.status === 404
                ? "webhook_gone"
                : res.status >= 500
                  ? "discord_error"
                  : "bad_request";
      return { ok: false, status: res.status, code };
    }
  }
  const body = (content) => ({
    content,
    allowed_mentions: { parse: [] },
    // SUPPRESS_EMBEDS: no preview, whatever the text holds.
    flags: 4,
  });
  return {
    async post(url, content) {
      if (!parseWebhook(url))
        return { ok: false, status: 0, code: "bad_request" };
      return call("POST", `${url}?wait=true`, body(content));
    },
    async edit(url, messageId, content) {
      if (!parseWebhook(url) || !validMessageId(messageId))
        return { ok: false, status: 0, code: "bad_request" };
      return call("PATCH", `${url}/messages/${messageId}`, body(content));
    },
  };
}
