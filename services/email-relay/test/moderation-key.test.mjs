/**
 * Comments' moderation key in the relay (2026-11-17): read from its own
 * secret on first use and kept in memory; a missing, unreadable or
 * malformed secret is no key (every check `moderation_off`), logged once
 * by cause without the value; a refused key is read again, at most once
 * each five minutes. No test calls AWS: the secret read is a function.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createModelWorker,
  modelReplyKey,
  modelRequestKey,
} from "@elixir-mcp/clan/model-bridge.mjs";
import { createBox } from "@elixir-mcp/clan/sealed.mjs";
import {
  MODERATION_KEY_MAX_AGE_MS,
  MODERATION_KEY_RETRY_MS,
  moderationKeyFromSecret,
} from "../src/moderation-key.mjs";

const KEY_A = `sk-ant-invented-${"a".repeat(24)}`;
const KEY_B = `sk-ant-invented-${"b".repeat(24)}`;
const secretOf = (k) => JSON.stringify({ moderation_api_key: k });

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

function source(reads, opts = {}) {
  const logs = [];
  const c = clock();
  let i = 0;
  const calls = { n: 0 };
  const src = moderationKeyFromSecret(
    async () => {
      calls.n++;
      const next = reads[Math.min(i++, reads.length - 1)];
      if (next instanceof Error) throw next;
      return next;
    },
    { now: c.now, log: (...a) => logs.push(a.join(" ")), ...opts },
  );
  return { src, logs, c, calls };
}

test("the key is read once and kept in memory between checks", async () => {
  const { src, calls } = source([secretOf(KEY_A)]);
  assert.equal(await src.get(), KEY_A);
  assert.equal(await src.get(), KEY_A);
  assert.equal(await src.get(), KEY_A);
  assert.equal(calls.n, 1);
});

test("concurrent first checks share one read", async () => {
  const { src, calls } = source([secretOf(KEY_A)]);
  const got = await Promise.all([src.get(), src.get(), src.get()]);
  assert.deepEqual(got, [KEY_A, KEY_A, KEY_A]);
  assert.equal(calls.n, 1);
});

test("a missing, unreadable or malformed secret is no key, logged once by cause, never the value", async () => {
  const missing = Object.assign(new Error(`not found ${KEY_A}`), {
    name: "ResourceNotFoundException",
  });
  for (const [reads, cause] of [
    [[missing], "ResourceNotFoundException"],
    [[new Error(`boom ${KEY_A}`)], "Error"],
    [["not json"], "moderation_secret_shape"],
    [[JSON.stringify({ other: KEY_A })], "moderation_secret_shape"],
    [[secretOf(` ${KEY_A}\n`)], "moderation_secret_shape"],
    [[secretOf("short")], "moderation_secret_shape"],
    [[undefined], "moderation_secret_shape"],
  ]) {
    const { src, logs, c } = source(reads);
    assert.equal(await src.get(), null, cause);
    // Read again after the retry wait, still failing: no second log line.
    c.advance(MODERATION_KEY_RETRY_MS);
    assert.equal(await src.get(), null, cause);
    assert.deepEqual(logs, [`moderation_key_unavailable ${cause}`], cause);
    assert.equal(logs.join().includes(KEY_A), false);
  }
});

test("a failed read is not retried on every check, only after five minutes", async () => {
  const { src, calls, c } = source([new Error("throttled"), secretOf(KEY_A)]);
  assert.equal(await src.get(), null);
  assert.equal(await src.get(), null);
  assert.equal(calls.n, 1);
  c.advance(MODERATION_KEY_RETRY_MS - 1);
  assert.equal(await src.get(), null);
  assert.equal(calls.n, 1);
  c.advance(1);
  assert.equal(await src.get(), KEY_A);
  assert.equal(calls.n, 2);
});

test("a rotated key is picked up: after an hour, or after a refusal at most once each five minutes", async () => {
  const { src, calls, c } = source([secretOf(KEY_A), secretOf(KEY_B)]);
  assert.equal(await src.get(), KEY_A);
  c.advance(MODERATION_KEY_MAX_AGE_MS - 1);
  assert.equal(await src.get(), KEY_A);
  c.advance(1);
  assert.equal(await src.get(), KEY_B);
  assert.equal(calls.n, 2);

  const r = source([secretOf(KEY_A), secretOf(KEY_A), secretOf(KEY_B)]);
  assert.equal(await r.src.get(), KEY_A);
  // Refused at once: no read yet, five minutes have not passed.
  r.src.rejected();
  assert.equal(await r.src.get(), KEY_A);
  assert.equal(r.calls.n, 1);
  r.c.advance(MODERATION_KEY_RETRY_MS);
  assert.equal(await r.src.get(), KEY_A);
  assert.equal(r.calls.n, 2);
  // Refused again: still the old value in the secret; wait, then the new.
  r.src.rejected();
  r.c.advance(MODERATION_KEY_RETRY_MS);
  assert.equal(await r.src.get(), KEY_B);
  assert.equal(r.calls.n, 3);
});

test("a secret that goes missing later turns the checks off", async () => {
  const gone = Object.assign(new Error("gone"), {
    name: "ResourceNotFoundException",
  });
  const { src, c } = source([secretOf(KEY_A), gone]);
  assert.equal(await src.get(), KEY_A);
  c.advance(MODERATION_KEY_MAX_AGE_MS);
  assert.equal(await src.get(), null);
});

// The worker with the relay's source: what a check answers end to end.
function memory() {
  const objects = new Map();
  return {
    objects,
    async get(k) {
      return objects.has(k) ? objects.get(k) : null;
    },
    async put(k, v) {
      if (k.includes("/claim/") && objects.has(k)) return false;
      objects.set(k, v);
      return true;
    },
  };
}

const ID = "00000000-0000-4000-8000-0000000000aa";
const INPUT = {
  model: "claude-haiku-5-5",
  max_tokens: 64,
  effort: "low",
  system: "policy",
  prompt: "a comment",
  tool: { name: "verdict", input_schema: { type: "object" } },
};

async function check(moderationKey, provider) {
  const storage = memory();
  const box = createBox("relay-secret", "clan model bridge v1");
  storage.objects.set(
    modelRequestKey(ID),
    JSON.stringify({
      v: 1,
      id: ID,
      box: box.seal(
        JSON.stringify({
          key: null,
          method: "moderate",
          input: INPUT,
          expires_at: 45_000,
        }),
        `request:${ID}`,
      ),
    }),
  );
  const worker = createModelWorker({
    secret: "relay-secret",
    storage,
    now: () => 1,
    moderationKey,
    provider,
  });
  await worker(modelRequestKey(ID));
  const reply = JSON.parse(storage.objects.get(modelReplyKey(ID)));
  const opened = JSON.parse(box.open(reply.box, `reply:${ID}`));
  return { opened, stored: [...storage.objects.values()].join() };
}

test("no secret: the check answers moderation_off and the provider is never called", async () => {
  let calls = 0;
  const provider = {
    write: async () => {
      calls++;
      return { ok: true, input: { allow: true } };
    },
  };
  const { src } = source([new Error("missing")]);
  const { opened } = await check(src, provider);
  assert.equal(opened.ok, false);
  assert.equal(opened.code, "moderation_off");
  assert.equal(calls, 0);
  // No source at all (comments off): the same.
  assert.equal((await check(null, provider)).opened.code, "moderation_off");
  assert.equal(calls, 0);
});

test("the key reaches the provider and nothing stored or logged; a 401 asks for a re-read", async () => {
  const seen = [];
  const { src, logs } = source([secretOf(KEY_A)]);
  let rejected = 0;
  const watched = {
    get: () => src.get(),
    rejected: () => {
      rejected++;
      src.rejected();
    },
  };
  const ok = await check(watched, {
    write: async (k) => {
      seen.push(k);
      return { ok: true, input: { allow: true, category: "none" } };
    },
  });
  assert.equal(ok.opened.ok, true);
  assert.equal(ok.stored.includes(KEY_A), false);
  assert.equal(rejected, 0);
  const refused = await check(watched, {
    write: async (k) => {
      seen.push(k);
      return {
        ok: false,
        status: 401,
        code: "authentication_error",
        message: "invalid x-api-key",
      };
    },
  });
  assert.equal(refused.opened.ok, false);
  assert.equal(refused.stored.includes(KEY_A), false);
  assert.equal(JSON.stringify(refused.opened).includes(KEY_A), false);
  assert.equal(rejected, 1);
  assert.deepEqual(seen, [KEY_A, KEY_A]);
  assert.equal(logs.join().includes(KEY_A), false);
});
