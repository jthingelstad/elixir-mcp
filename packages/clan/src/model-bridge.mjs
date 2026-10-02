/** One private network operation on the clan's own model key. The API
 * reaches S3 through its existing gateway endpoint; the existing relay
 * has internet egress. Requests and replies are sealed, short lived and
 * bound to a random id. A worker claims once BEFORE any provider call:
 * redelivery must never spend the clan's tokens twice. */
import { randomUUID } from "node:crypto";
import { createBox } from "./sealed.mjs";
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const PREFIX = "clan-model/";
const MAX_BYTES = 262144;
const LIFETIME_MS = 45_000;
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
  if (request.method === "models") return request.input === null;
  const input = request.input;
  return (
    input &&
    typeof input.model === "string" &&
    input.model.startsWith("claude-") &&
    typeof input.system === "string" &&
    typeof input.prompt === "string" &&
    typeof input.tool?.name === "string" &&
    input.tool.input_schema?.type === "object" &&
    Number.isInteger(input.max_tokens) &&
    input.max_tokens > 0 &&
    input.max_tokens <= 8192
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
  async function call(method, key, input = null) {
    const waitMs = typeof timeoutMs === "function" ? timeoutMs() : timeoutMs;
    if (!Number.isFinite(waitMs) || waitMs < 1000)
      return { ok: false, status: 503, code: "model_not_started" };
    const end = now() + waitMs;
    const id = randomUUID();
    const request = { method, key, input, expires_at: now() + LIFETIME_MS };
    if (!validRequest(request))
      return { ok: false, status: 400, code: "invalid_model_request" };
    const text = encode(box, id, "request", request);
    if (Buffer.byteLength(text) > MAX_BYTES)
      return { ok: false, status: 400, code: "model_request_too_large" };
    try {
      if (!(await storage.put(modelRequestKey(id), text))) return unknown();
      while (now() < end) {
        const reply = await storage.get(modelReplyKey(id));
        if (reply !== null) return decode(box, reply, id, "reply");
        await pause(Math.min(150, Math.max(1, end - now())));
      }
    } catch {
      // A write or reply read may fail after the worker received it.
      // Return uncertainty so the reserved use remains visible and counted.
      return unknown();
    }
    return unknown();
  }
  return {
    models: (key) => call("models", key),
    write: (key, input) => call("write", key, input),
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
        response = await provider[request.method](request.key, request.input);
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
