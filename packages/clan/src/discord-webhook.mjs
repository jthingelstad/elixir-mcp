/**
 * A clan's Discord webhook (2026-10-10): post a message and edit it, the
 * two calls the relay makes for Actions in Discord and for the timeline's
 * lines. Called only from the relay, the one component with internet
 * egress; Clan's VPC side reaches it through the sealed bridge
 * (`discord-bridge.mjs`).
 *
 * Every message is sent with no mentions allowed, so a member named
 * "@everyone" pings nobody, and with embeds suppressed (the links are
 * also wrapped in <>). The one exception is a role a clan's leaders chose
 * to ping on a new Action (2026-10-11): that role alone, on that post
 * alone, never on an edit.
 *
 * A 429 is Discord saying it did NOT take the message, so it is the one
 * answer waited out and tried again here; a longer wait than this call
 * may spend is handed back (`retry_after_ms`) for the queue to wait out.
 * The webhook's own budget is read from Discord's X-RateLimit headers and
 * the next call waits for it, rather than spending a 429. A timeout or
 * lost connection leaves the outcome unknown and is never retried, so a
 * post is never made twice. Any other refusal carries Discord's own words
 * (`reason`), so a leader or owner reads what Discord said.
 *
 * A webhook may name a thread (`?thread_id=`); a forum channel takes no
 * plain message, only a post of its own, so a caller that names one
 * (`thread_name`, an Action's title) gets a new forum post when Discord
 * says the channel is a forum, and the thread's id back to edit it in.
 * Nothing logs the URL, whose last part is the webhook's secret.
 */

import {
  parseDiscordWebhook,
  discordWebhookCall,
  DISCORD_FORUM_NEEDS_THREAD,
} from "@elixir-mcp/contracts";

const SNOWFLAKE = /^[0-9]{15,25}$/;

/**
 * The webhook a leader pasted, in its one canonical spelling, or null.
 * One parser for everything Elixir posts to Discord (contracts); a query
 * string other than `?thread_id=` is refused rather than dropped.
 */
export function parseWebhook(text) {
  const hook = parseDiscordWebhook(String(text ?? ""));
  return hook
    ? { id: hook.id, url: hook.url, thread_id: hook.thread_id }
    : null;
}

export const validMessageId = (id) => SNOWFLAKE.test(String(id ?? ""));
/** A Discord role's id (a leader's pick of whom a new Action pings). */
export const validRoleId = (id) => SNOWFLAKE.test(String(id ?? ""));

/** Discord's own error codes that mean the webhook or message is gone. */
const UNKNOWN_WEBHOOK = 10015;
const UNKNOWN_MESSAGE = 10008;
const THREAD_NAME_MAX = 100;
const REASON_MAX = 200;

/** Discord's words for a refusal: its message, and the first field error
 *  of an "Invalid Form Body". Never the request. */
export function discordReason(json) {
  if (!json || typeof json !== "object") return null;
  const message = typeof json.message === "string" ? json.message : "";
  let detail = "";
  const walk = (node, depth) => {
    if (detail || !node || typeof node !== "object" || depth > 6) return;
    if (Array.isArray(node._errors)) {
      const first = node._errors.find((e) => typeof e?.message === "string");
      if (first) detail = first.message;
      return;
    }
    for (const v of Object.values(node)) walk(v, depth + 1);
  };
  walk(json.errors, 0);
  const text = [message, detail].filter(Boolean).join(": ");
  return text ? text.slice(0, REASON_MAX) : null;
}

export function createDiscordWebhook({
  fetch = globalThis.fetch,
  timeoutMs = 10_000,
  pause = (ms) => new Promise((r) => setTimeout(r, ms)),
  /** How many 429s are waited out before the answer is "rate_limited". */
  retries = 3,
  /** The longest single wait Discord may ask for that is waited here. */
  maxWaitMs = 10_000,
  /** Who is posting, as Discord's API asks every caller to say. */
  userAgent = "ElixirClan (https://elixir.poapkings.com/clan, 1)",
  clock = () => Date.now(),
} = {}) {
  /** Per webhook: when Discord said its budget is back (X-RateLimit). */
  const resetAt = new Map();

  function remember(hookId, res) {
    const remaining = res.headers?.get?.("x-ratelimit-remaining");
    const after = Number(res.headers?.get?.("x-ratelimit-reset-after"));
    if (remaining === "0" && Number.isFinite(after) && after > 0)
      resetAt.set(hookId, clock() + Math.ceil(after * 1000));
  }

  async function call(hookId, method, url, body) {
    for (let attempt = 0; ; attempt++) {
      const wait = (resetAt.get(hookId) ?? 0) - clock();
      if (wait > 0) {
        if (wait > maxWaitMs)
          return {
            ok: false,
            status: 429,
            code: "rate_limited",
            retry_after_ms: wait,
          };
        await pause(wait);
      }
      let res;
      try {
        res = await fetch(url, {
          method,
          headers: {
            "content-type": "application/json",
            "user-agent": userAgent,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        return { ok: false, status: 0, code: "outcome_unknown" };
      }
      remember(hookId, res);
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
        const seconds = Number(
          json?.retry_after ?? res.headers?.get?.("retry-after") ?? 1,
        );
        const waitMs = Math.ceil(
          (Number.isFinite(seconds) ? seconds : 1) * 1000,
        );
        if (attempt < retries && waitMs <= maxWaitMs) {
          await pause(Math.max(waitMs, 250));
          continue;
        }
        return {
          ok: false,
          status: 429,
          code: "rate_limited",
          retry_after_ms: Math.max(waitMs, 250),
        };
      }
      const code =
        json?.code === UNKNOWN_WEBHOOK
          ? "webhook_gone"
          : json?.code === UNKNOWN_MESSAGE
            ? "message_gone"
            : json?.code === DISCORD_FORUM_NEEDS_THREAD
              ? "forum_needs_thread"
              : res.status === 401 || res.status === 403
                ? "webhook_refused"
                : res.status === 404
                  ? "webhook_gone"
                  : res.status >= 500
                    ? "discord_error"
                    : "bad_request";
      const reason = discordReason(json);
      return {
        ok: false,
        status: res.status,
        code,
        ...(Number.isInteger(json?.code) ? { discord_code: json.code } : {}),
        ...(reason ? { reason } : {}),
      };
    }
  }
  const body = (content, roleId = null) => ({
    content,
    allowed_mentions:
      roleId && validRoleId(roleId)
        ? { parse: [], roles: [roleId] }
        : { parse: [] },
    // SUPPRESS_EMBEDS: no preview, whatever the text holds.
    flags: 4,
  });
  const threadName = (name) =>
    String(name ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, THREAD_NAME_MAX);
  return {
    /**
     * Post one message. `thread_name`: on a forum channel, make it a post
     * of its own under that name (`forum: true` says the channel is known
     * to be one, so the plain message is not tried first). `mention_role`:
     * the one role this post may ping.
     */
    async post(
      url,
      content,
      { thread_name = null, forum = false, mention_role = null } = {},
    ) {
      const hook = parseDiscordWebhook(String(url ?? ""));
      if (!hook) return { ok: false, status: 0, code: "bad_request" };
      const name = hook.thread_id ? "" : threadName(thread_name);
      const send = (asForum) =>
        call(
          hook.id,
          "POST",
          discordWebhookCall(hook, "", { wait: "true" }),
          asForum
            ? { ...body(content, mention_role), thread_name: name }
            : body(content, mention_role),
        );
      if (forum && name) {
        const r = await send(true);
        return r.ok ? { ...r, forum: true, thread_id: r.channel_id } : r;
      }
      const r = await send(false);
      // Discord did not take it: a forum wants a post of its own.
      if (!r.ok && r.code === "forum_needs_thread" && name) {
        const again = await send(true);
        return again.ok
          ? { ...again, forum: true, thread_id: again.channel_id }
          : again;
      }
      return r;
    },
    /** Edit a message, in its thread when it is in one (a forum post's
     *  first message is edited in its own thread). Never pings. */
    async edit(url, messageId, content, { thread_id = null } = {}) {
      const hook = parseDiscordWebhook(String(url ?? ""));
      if (!hook || !validMessageId(messageId))
        return { ok: false, status: 0, code: "bad_request" };
      if (thread_id !== null && !validMessageId(thread_id))
        return { ok: false, status: 0, code: "bad_request" };
      const target = thread_id ? { ...hook, thread_id } : hook;
      return call(
        hook.id,
        "PATCH",
        discordWebhookCall(target, `/messages/${messageId}`),
        body(content),
      );
    },
  };
}
