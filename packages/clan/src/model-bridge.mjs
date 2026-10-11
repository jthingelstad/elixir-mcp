/** One private network operation on the clan's own model key. The API
 * reaches S3 through its existing gateway endpoint; the existing relay
 * has internet egress. Requests and replies are sealed, short lived and
 * bound to a random id. A worker claims once BEFORE any provider call:
 * redelivery must never spend the clan's tokens twice.
 *
 * A call may be waited for (`write`) or started and collected (`start`,
 * `collect`; 2026-10-11): a leader's draft on Opus 5.5 at medium effort
 * can take longer than the web API's 30 s, so the request starts, the
 * page asks again, and the reply is read when it lands. The relay's own
 * wait is the request's `timeout_ms` (at most `MODEL_TIMEOUT_MS`). */
import { randomUUID } from "node:crypto";
import { createBox } from "./sealed.mjs";
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const PREFIX = "clan-model/";
const MAX_BYTES = 262144;
const LIFETIME_MS = 45_000;
/** The relay's longest wait for the provider (`anthropic.mjs`). */
const PROVIDER_MAX_MS = 55_000;
/** A started write's wait for the provider: the relay's 60 s run holds
 *  one model request (its own queue, one record a run; the stack's
 *  `ClanModelQueue`) with room left for the claim and the reply. */
export const DEFERRED_RELAY_MS = 50_000;
export const modelRequestKey = (id) => `${PREFIX}request/${id}.json`;
export const modelReplyKey = (id) => `${PREFIX}reply/${id}.json`;
export const modelClaimKey = (id) => `${PREFIX}claim/${id}.json`;
export function modelRequestId(key) {
  const match = /^clan-model\/request\/([^/]+)\.json$/.exec(key);
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
    throw new Error("invalid private model payload");
  const envelope = JSON.parse(text);
  if (envelope.v !== 1 || envelope.id !== id || !UUID.test(id))
    throw new Error("invalid private model envelope");
  const plain = box.open(envelope.box, `${kind}:${id}`);
  if (!plain) throw new Error("private model authentication failed");
  return JSON.parse(plain);
}
const unknown = () => ({
  ok: false,
  status: 0,
  code: "outcome_unknown",
  message:
    "The model did not answer in time. Its request may have reached the provider; review the use record before trying again.",
});
function validRequest(request) {
  if (
    !request ||
    !/^sk-ant-[A-Za-z0-9_-]{20,200}$/.test(request.key ?? "") ||
    !["models", "write"].includes(request.method)
  )
    return false;
  if (
    request.timeout_ms != null &&
    !(
      Number.isInteger(request.timeout_ms) &&
      request.timeout_ms >= 1000 &&
      request.timeout_ms <= PROVIDER_MAX_MS
    )
  )
    return false;
  if (request.method === "models") return request.input === null;
  const input = request.input;
  return Boolean(
    input &&
    typeof input.model === "string" &&
    input.model.startsWith("claude-") &&
    typeof input.system === "string" &&
    (input.context == null || typeof input.context === "string") &&
    typeof input.prompt === "string" &&
    (input.effort == null ||
      ["low", "medium", "high"].includes(input.effort)) &&
    typeof input.tool?.name === "string" &&
    input.tool.input_schema?.type === "object" &&
    (input.tool.strict == null || input.tool.strict === true) &&
    Number.isInteger(input.max_tokens) &&
    input.max_tokens > 0 &&
    input.max_tokens <= 8192,
  );
}
export function createModelBridge({
  secret,
  storage,
  now = Date.now,
  pause = (ms) => new Promise((r) => setTimeout(r, ms)),
  timeoutMs = 25_000,
}) {
  const box = createBox(secret, "clan model bridge v1");
  const waitNow = () =>
    typeof timeoutMs === "function" ? timeoutMs() : timeoutMs;
  /** Put a sealed request: `{ ok: true, id }`, or why it was not sent. */
  async function start(method, key, input = null, { relayMs = null } = {}) {
    const id = randomUUID();
    const request = {
      method,
      key,
      input,
      expires_at: now() + LIFETIME_MS,
      ...(relayMs != null ? { timeout_ms: relayMs } : {}),
    };
    if (!validRequest(request))
      return { ok: false, status: 400, code: "invalid_model_request" };
    const text = encode(box, id, "request", request);
    if (Buffer.byteLength(text) > MAX_BYTES)
      return { ok: false, status: 400, code: "model_request_too_large" };
    try {
      if (!(await storage.put(modelRequestKey(id), text))) return unknown();
    } catch {
      return unknown();
    }
    return { ok: true, id };
  }
  /** The reply to a started request, waiting up to `waitMs`: the reply,
   *  null when none has landed yet, or uncertainty when it cannot be
   *  read. */
  async function collect(id, waitMs = waitNow()) {
    if (!UUID.test(String(id ?? ""))) return unknown();
    const end = now() + Math.max(0, waitMs);
    try {
      for (;;) {
        const reply = await storage.get(modelReplyKey(id));
        if (reply !== null) return decode(box, reply, id, "reply");
        if (now() >= end) return null;
        await pause(Math.min(150, Math.max(1, end - now())));
      }
    } catch {
      // A write or reply read may fail after the worker received it.
      // Return uncertainty so the reserved use remains visible and counted.
      return unknown();
    }
  }
  async function call(method, key, input = null) {
    const waitMs = waitNow();
    if (!Number.isFinite(waitMs) || waitMs < 1000)
      return { ok: false, status: 503, code: "model_not_started" };
    const end = now() + waitMs;
    const started = await start(method, key, input, {
      relayMs: method === "write" ? Math.min(PROVIDER_MAX_MS, waitMs) : null,
    });
    if (!started.ok) return started;
    return (await collect(started.id, end - now())) ?? unknown();
  }
  return {
    models: (key) => call("models", key),
    write: (key, input) => call("write", key, input),
    /** Start a write the caller collects later: `{ ok, id }`. The relay
     *  waits up to `relayMs` (50 s unless given; at most 55 s) for the
     *  provider. */
    start: (key, input, { relayMs = DEFERRED_RELAY_MS } = {}) => {
      const waitMs = waitNow();
      if (!Number.isFinite(waitMs) || waitMs < 1000)
        return Promise.resolve({
          ok: false,
          status: 503,
          code: "model_not_started",
        });
      return start("write", key, input, { relayMs });
    },
    collect,
  };
}
export function createModelWorker({
  secret,
  storage,
  provider,
  now = Date.now,
}) {
  const box = createBox(secret, "clan model bridge v1");
  return async function work(key) {
    const id = modelRequestId(key);
    if (!id) throw new Error("unsupported private model object");
    if ((await storage.get(modelReplyKey(id))) !== null) return;
    const text = await storage.get(key);
    if (text === null) return;
    const request = decode(box, text, id, "request");
    if (
      !validRequest(request) ||
      !Number.isFinite(request.expires_at) ||
      request.expires_at > now() + LIFETIME_MS
    )
      throw new Error("invalid private model request");
    let response;
    if (request.expires_at <= now())
      response =
        (await storage.get(modelClaimKey(id))) === null
          ? { ok: false, status: 0, code: "expired" }
          : unknown();
    else if (
      await storage.put(modelClaimKey(id), JSON.stringify({ at: now() }))
    ) {
      try {
        response =
          request.method === "write"
            ? await provider.write(request.key, {
                ...request.input,
                ...(request.timeout_ms
                  ? { timeoutMs: request.timeout_ms }
                  : {}),
              })
            : await provider.models(request.key);
      } catch {
        response = unknown();
      }
    } else {
      // An interrupted claimed call has an uncertain outcome. Never retry
      // the provider. Keep the eventual first worker's reply if it arrives.
      if (request.expires_at > now())
        throw new Error("private model reply pending");
      response = unknown();
    }
    await storage.put(modelReplyKey(id), encode(box, id, "reply", response));
  };
}
