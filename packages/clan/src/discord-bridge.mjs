/** Actions in Discord (2026-10-10): Clan's VPC side hands a post or an
 * edit to the relay, the one component with internet egress, through the
 * outbox bucket, the way the clan's own model does (`model-bridge.mjs`).
 * Requests and replies are sealed (the webhook's address is its secret),
 * bound to a random id, and short lived. The worker claims a request
 * once BEFORE calling Discord, so a redelivered notification never posts
 * twice. The caller may wait for the reply (a leader connecting the
 * webhook) or collect it later (the message id an Action's post needs
 * before it can be edited).
 *
 * A sweep's Actions (2026-10-11) go as ONE request of ordered `ops`
 * (`prepare` then `publish`, so the caller can keep the request's id
 * before anything is in the outbox, #453). The worker takes them in
 * order, spaced `SPACING_MS` apart, and claims each before its call and
 * records each answer as it comes (`reply/<id>.<n>`), so a worker that
 * stops part way is picked up where it stopped: the op it was calling is
 * unknown (never sent again), the ones after it are still sent. A
 * webhook Discord says is gone, or a rate limit longer than the client
 * waits, ends the run: the rest are `not_sent`, for the next sweep. */
import { randomUUID } from "node:crypto";
import { createBox } from "./sealed.mjs";
import {
  parseWebhook,
  validMessageId,
  validRoleId,
} from "./discord-webhook.mjs";
import { DISCORD_MAX_CHARS } from "@elixir-mcp/clan-engine";

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const PREFIX = "clan-discord/";
/** A sweep's ten ops, sealed, with room. */
const MAX_BYTES = 65536;
/** A request the relay has not taken within this is never sent. */
export const DISCORD_REQUEST_LIFETIME_MS = 3600_000;
/** A claim this old with no reply was a worker that stopped mid-call. */
const CLAIM_SETTLE_MS = 60_000;
const DOMAIN = "clan discord bridge v1";
/** The most ops one request carries (a sweep's worth). */
export const DISCORD_OPS_MAX = 10;
/** Between two calls in one request: under Discord's ~30 a minute per
 *  channel, with room for the timeline's lines in the same channel. */
export const SPACING_MS = 2400;
/** A run starts no new op past this; the rest go to the next sweep. */
const BUDGET_MS = 35_000;
/** Answers after which the rest of a request is not sent. */
const STOPS = new Set(["webhook_gone", "webhook_refused", "rate_limited"]);
export const discordRequestKey = (id) => `${PREFIX}request/${id}.json`;
export const discordReplyKey = (id) => `${PREFIX}reply/${id}.json`;
export const discordClaimKey = (id) => `${PREFIX}claim/${id}.json`;
/** One op's claim and answer, inside a request of `ops`. */
export const discordOpClaimKey = (id, n) => `${PREFIX}claim/${id}.${n}.json`;
export const discordOpReplyKey = (id, n) => `${PREFIX}reply/${id}.${n}.json`;
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
/** One post or edit: its text, and for a post the forum post's name and
 *  the one role it may ping; for an edit its message and thread. */
function validOp(r) {
  if (
    !r ||
    !["post", "edit"].includes(r.method) ||
    typeof r.content !== "string" ||
    r.content.length < 1 ||
    r.content.length > DISCORD_MAX_CHARS
  )
    return false;
  if (
    r.thread_name != null &&
    (typeof r.thread_name !== "string" || r.thread_name.length > 100)
  )
    return false;
  if (r.method === "edit")
    return (
      validMessageId(r.message_id) &&
      (r.thread_id == null || validMessageId(r.thread_id)) &&
      r.mention_role == null
    );
  return (
    !r.message_id &&
    r.thread_id == null &&
    (r.mention_role == null || validRoleId(r.mention_role))
  );
}
function validRequest(r) {
  if (
    !r ||
    !parseWebhook(r.url) ||
    parseWebhook(r.url).url !== r.url ||
    !Number.isFinite(r.expires_at) ||
    (r.forum != null && typeof r.forum !== "boolean")
  )
    return false;
  if (r.ops !== undefined)
    return (
      r.method === undefined &&
      Array.isArray(r.ops) &&
      r.ops.length >= 1 &&
      r.ops.length <= DISCORD_OPS_MAX &&
      r.ops.every(validOp)
    );
  return validOp(r);
}
const unknown = () => ({ ok: false, status: 0, code: "outcome_unknown" });

export function createDiscordBridge({
  secret,
  storage,
  now = Date.now,
  pause = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  const box = createBox(secret, DOMAIN);
  async function put(id, text) {
    try {
      if (!(await storage.put(discordRequestKey(id), text)))
        return { ok: false, code: "outbox_refused" };
    } catch {
      return { ok: false, code: "outbox_unavailable" };
    }
    return { ok: true, id };
  }
  return {
    /**
     * Hand one post or edit to the relay. `{ ok: true, id }` once it is in
     * the outbox; the reply is then `reply(id)`'s to read.
     */
    async send({
      method,
      url,
      content,
      message_id = null,
      thread_name = null,
      forum = null,
    }) {
      const id = randomUUID();
      const request = {
        method,
        url,
        content,
        ...(method === "edit" ? { message_id } : {}),
        ...(thread_name ? { thread_name } : {}),
        ...(forum !== null ? { forum } : {}),
        expires_at: now() + DISCORD_REQUEST_LIFETIME_MS,
      };
      if (!validRequest(request))
        return { ok: false, code: "invalid_discord_request" };
      return put(id, encode(box, id, "request", request));
    },
    /**
     * A sweep's ops, sealed under a new id but not yet in the outbox: the
     * caller records the id first, then `publish`es it (#453).
     */
    prepare({ url, ops, forum = null }) {
      const id = randomUUID();
      const request = {
        url,
        ops,
        ...(forum !== null ? { forum } : {}),
        expires_at: now() + DISCORD_REQUEST_LIFETIME_MS,
      };
      if (!validRequest(request))
        return { ok: false, code: "invalid_discord_request" };
      return { ok: true, id, text: encode(box, id, "request", request) };
    },
    /** Put a prepared request in the outbox. Already there is sent. */
    async publish(prepared) {
      const r = await put(prepared.id, prepared.text);
      return r.code === "outbox_refused" ? { ok: true, id: prepared.id } : r;
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

/** How old a claim's `at` is, or Infinity when it cannot be read. */
function claimAge(text, nowMs) {
  try {
    const at = JSON.parse(text).at;
    return Number.isFinite(at) ? nowMs - at : Infinity;
  } catch {
    return Infinity;
  }
}

export function createDiscordWorker({
  secret,
  storage,
  discord,
  now = Date.now,
  pause = (ms) => new Promise((r) => setTimeout(r, ms)),
  spacingMs = SPACING_MS,
  budgetMs = BUDGET_MS,
  log = console,
}) {
  const box = createBox(secret, DOMAIN);
  const call = (request, op) =>
    op.method === "post"
      ? discord.post(request.url, op.content, {
          thread_name: op.thread_name ?? null,
          forum: request.forum === true,
          mention_role: op.mention_role ?? null,
        })
      : discord.edit(request.url, op.message_id, op.content, {
          thread_id: op.thread_id ?? null,
        });
  // Never the URL: its last part is the webhook's secret.
  const said = (method, response) =>
    log.log("clan_discord", method, response.ok ? "ok" : response.code);

  /** A sweep's ops, in order; each answer recorded as it comes. */
  async function runOps(id, request) {
    const results = [];
    const started = now();
    let calledAt = null;
    for (let n = 0; n < request.ops.length; n++) {
      const op = request.ops[n];
      const recorded = await storage.get(discordOpReplyKey(id, n));
      if (recorded !== null) {
        results.push(decode(box, recorded, id, `reply.${n}`));
        continue;
      }
      let response = null;
      let claimed = await storage.get(discordOpClaimKey(id, n));
      if (claimed !== null) {
        // Another worker, or one that stopped mid-call.
        if (claimAge(claimed, now()) < CLAIM_SETTLE_MS)
          throw new Error("private discord reply pending");
        response = unknown();
      } else if (results.some((r) => !r.ok && STOPS.has(r.code)))
        response = { ok: false, status: 0, code: "not_sent" };
      else if (request.expires_at <= now())
        response = { ok: false, status: 0, code: "expired" };
      else if (now() - started > budgetMs)
        response = { ok: false, status: 0, code: "not_sent" };
      else {
        if (calledAt !== null) {
          const wait = calledAt + spacingMs - now();
          if (wait > 0) await pause(wait);
        }
        if (
          !(await storage.put(
            discordOpClaimKey(id, n),
            JSON.stringify({ at: now() }),
          ))
        ) {
          claimed = (await storage.get(discordOpClaimKey(id, n))) ?? "{}";
          if (claimAge(claimed, now()) < CLAIM_SETTLE_MS)
            throw new Error("private discord reply pending");
          response = unknown();
        } else {
          calledAt = now();
          try {
            response = await call(request, op);
          } catch {
            response = unknown();
          }
          said(op.method, response);
        }
      }
      // Only what was decided here is recorded: an op not sent stays
      // open for a later run of this request only through its reply.
      if (!["not_sent", "expired"].includes(response.code))
        await storage.put(
          discordOpReplyKey(id, n),
          encode(box, id, `reply.${n}`, response),
        );
      results.push(response);
    }
    return { ok: true, results };
  }

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
    if (request.ops) {
      const reply = await runOps(id, request);
      await storage.put(discordReplyKey(id), encode(box, id, "reply", reply));
      return;
    }
    let response = null;
    let claimed = await storage.get(discordClaimKey(id));
    if (claimed === null && request.expires_at <= now())
      response = { ok: false, status: 0, code: "expired" };
    else if (claimed === null) {
      if (
        await storage.put(discordClaimKey(id), JSON.stringify({ at: now() }))
      ) {
        try {
          response = await call(request, request);
        } catch {
          response = unknown();
        }
        said(request.method, response);
      } else claimed = (await storage.get(discordClaimKey(id))) ?? "{}";
    }
    if (response === null) {
      // Another worker holds the claim. Leave it time to answer; after
      // that the call's outcome is unknown and is never made again.
      if (claimAge(claimed, now()) < CLAIM_SETTLE_MS)
        throw new Error("private discord reply pending");
      response = unknown();
    }
    await storage.put(discordReplyKey(id), encode(box, id, "reply", response));
  };
}
