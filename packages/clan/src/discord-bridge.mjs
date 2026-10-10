/** Actions in Discord (2026-10-10): Clan's VPC side hands a post or an
 * edit to the relay, the one component with internet egress, through the
 * outbox bucket, the way the clan's own model does (`model-bridge.mjs`).
 * Requests and replies are sealed (the webhook's address is its secret),
 * bound to a random id, and short lived. The worker claims a request
 * once BEFORE calling Discord, so a redelivered notification never posts
 * twice. The caller may wait for the reply (a leader connecting the
 * webhook) or collect it later (the message id an Action's post needs
 * before it can be edited). */
import { randomUUID } from "node:crypto";
import { createBox } from "./sealed.mjs";
import { parseWebhook, validMessageId } from "./discord-webhook.mjs";
import { DISCORD_MAX_CHARS } from "@elixir-mcp/clan-engine";

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const PREFIX = "clan-discord/";
const MAX_BYTES = 16384;
/** A request the relay has not taken within this is never sent. */
export const DISCORD_REQUEST_LIFETIME_MS = 3600_000;
/** A claim this old with no reply was a worker that stopped mid-call. */
const CLAIM_SETTLE_MS = 60_000;
const DOMAIN = "clan discord bridge v1";
export const discordRequestKey = (id) => `${PREFIX}request/${id}.json`;
export const discordReplyKey = (id) => `${PREFIX}reply/${id}.json`;
export const discordClaimKey = (id) => `${PREFIX}claim/${id}.json`;
export function discordRequestId(key) {
  const match = /^clan-discord\/request\/([^/]+)\.json$/.exec(key);
  return match && UUID.test(match[1]) ? match[1] : null;
}
const encode = (box, id, kind, value) =>
  JSON.stringify({
    v: 1,
    id,
    box: box.seal(JSON.stringify(value), `${kind}:${id}`),
  });
function decode(box, text, id, kind) {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_BYTES)
    throw new Error("invalid private discord payload");
  const envelope = JSON.parse(text);
  if (envelope.v !== 1 || envelope.id !== id || !UUID.test(id))
    throw new Error("invalid private discord envelope");
  const plain = box.open(envelope.box, `${kind}:${id}`);
  if (!plain) throw new Error("private discord authentication failed");
  return JSON.parse(plain);
}
function validRequest(r) {
  if (
    !r ||
    !["post", "edit"].includes(r.method) ||
    !parseWebhook(r.url) ||
    parseWebhook(r.url).url !== r.url ||
    typeof r.content !== "string" ||
    r.content.length < 1 ||
    r.content.length > DISCORD_MAX_CHARS ||
    !Number.isFinite(r.expires_at)
  )
    return false;
  return r.method === "edit" ? validMessageId(r.message_id) : !r.message_id;
}
const unknown = () => ({ ok: false, status: 0, code: "outcome_unknown" });

export function createDiscordBridge({
  secret,
  storage,
  now = Date.now,
  pause = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  const box = createBox(secret, DOMAIN);
  return {
    /**
     * Hand one post or edit to the relay. `{ ok: true, id }` once it is in
     * the outbox; the reply is then `reply(id)`'s to read.
     */
    async send({ method, url, content, message_id = null }) {
      const id = randomUUID();
      const request = {
        method,
        url,
        content,
        ...(method === "edit" ? { message_id } : {}),
        expires_at: now() + DISCORD_REQUEST_LIFETIME_MS,
      };
      if (!validRequest(request))
        return { ok: false, code: "invalid_discord_request" };
      try {
        if (
          !(await storage.put(
            discordRequestKey(id),
            encode(box, id, "request", request),
          ))
        )
          return { ok: false, code: "outbox_refused" };
      } catch {
        return { ok: false, code: "outbox_unavailable" };
      }
      return { ok: true, id };
    },
    /** The relay's answer to a request, or null while there is none. */
    async reply(id) {
      if (!UUID.test(String(id ?? ""))) return null;
      const text = await storage.get(discordReplyKey(id));
      return text === null ? null : decode(box, text, id, "reply");
    },
    /** Wait up to `timeoutMs` for an answer; unknown when none came. */
    async wait(id, timeoutMs) {
      const end = now() + timeoutMs;
      try {
        while (now() < end) {
          const text = await storage.get(discordReplyKey(id));
          if (text !== null) return decode(box, text, id, "reply");
          await pause(Math.min(200, Math.max(1, end - now())));
        }
      } catch {
        return unknown();
      }
      return unknown();
    },
  };
}

export function createDiscordWorker({
  secret,
  storage,
  discord,
  now = Date.now,
  log = console,
}) {
  const box = createBox(secret, DOMAIN);
  return async function work(key) {
    const id = discordRequestId(key);
    if (!id) throw new Error("unsupported private discord object");
    if ((await storage.get(discordReplyKey(id))) !== null) return;
    const text = await storage.get(key);
    if (text === null) return;
    const request = decode(box, text, id, "request");
    if (
      !validRequest(request) ||
      request.expires_at > now() + DISCORD_REQUEST_LIFETIME_MS
    )
      throw new Error("invalid private discord request");
    let response = null;
    let claimed = await storage.get(discordClaimKey(id));
    if (claimed === null && request.expires_at <= now())
      response = { ok: false, status: 0, code: "expired" };
    else if (claimed === null) {
      if (
        await storage.put(discordClaimKey(id), JSON.stringify({ at: now() }))
      ) {
        try {
          response =
            request.method === "post"
              ? await discord.post(request.url, request.content)
              : await discord.edit(
                  request.url,
                  request.message_id,
                  request.content,
                );
        } catch {
          response = unknown();
        }
        // Never the URL: its last part is the webhook's secret.
        log.log(
          "clan_discord",
          request.method,
          response.ok ? "ok" : response.code,
        );
      } else claimed = (await storage.get(discordClaimKey(id))) ?? "{}";
    }
    if (response === null) {
      // Another worker holds the claim. Leave it time to answer; after
      // that the call's outcome is unknown and is never made again.
      let at = null;
      try {
        at = JSON.parse(claimed).at;
      } catch {
        // An unreadable claim is as old as can be.
      }
      if (Number.isFinite(at) && now() - at < CLAIM_SETTLE_MS)
        throw new Error("private discord reply pending");
      response = unknown();
    }
    await storage.put(discordReplyKey(id), encode(box, id, "reply", response));
  };
}
