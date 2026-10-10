/**
 * The relay's worker for the timeline's posts, on Clan's Discord client
 * and Clan's rules: a line is posted once and edited in place as it
 * grows; only a 429 is retried; a post whose outcome is unknown is never
 * made again; a line deleted in the channel stays deleted; a gone webhook
 * stops the batch and tells the sync; the webhook arrives sealed and
 * never reaches a log line.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  timelineDiscordStateKey,
  timelineDiscordStatusKey,
  webhookFingerprint,
} from "@elixir-mcp/contracts";
import { createBox } from "../../clan/src/sealed.mjs";
import { createDiscordWebhook } from "../../clan/src/discord-webhook.mjs";
import { createTimelineDiscordWorker } from "../src/relay.mjs";
import { webhookSeal, WEBHOOK_PURPOSE } from "../src/seal.mjs";

const ACCOUNT = "0b6b5a59-0e4f-4f39-9d55-58e41b6a3e7a";
const TOKEN = "t".repeat(68);
const HOOK = `https://discord.com/api/webhooks/123456789012345678/${TOKEN}`;
const FP = webhookFingerprint(HOOK);
const ITEM = "tl_0123456789abcdef0123";
const BUCKET = "elixir-mcp-outbox-1";
const { seal, open } = webhookSeal(
  createBox("relay-test-secret", WEBHOOK_PURPOSE),
);

function memoryStore() {
  const objects = new Map();
  let n = 0;
  const put = (key, body) => {
    const etag = `"e${(n += 1)}"`;
    objects.set(key, { body: structuredClone(body), etag });
    return etag;
  };
  return {
    objects,
    async read(key) {
      const o = objects.get(key);
      return o ? { body: structuredClone(o.body), etag: o.etag } : null;
    },
    async create(key, body) {
      return objects.has(key) ? null : put(key, body);
    },
    async replace(key, body, etag) {
      return objects.get(key)?.etag === etag ? put(key, body) : null;
    },
    async put(key, body) {
      put(key, body);
    },
    async remove(key) {
      objects.delete(key);
    },
    async readObject(obj) {
      const o = objects.get(obj.key);
      return o ? JSON.stringify(o.body) : null;
    },
    async deleteObject(obj) {
      objects.delete(obj.key);
    },
  };
}

/** Clan's client over a Discord that answers from a script. */
function fakeDiscord(script) {
  const calls = [];
  let id = 1000;
  const fetch = async (url, init) => {
    calls.push({ url, method: init.method, body: JSON.parse(init.body) });
    const next = script.shift() ?? { status: 200 };
    if (next.throws) throw new Error(`connect ECONNRESET ${url}`);
    const body =
      next.body ??
      (init.method === "POST"
        ? { id: `98765432109876${(id += 1)}` }
        : { id: "x" });
    return new Response(JSON.stringify(body), { status: next.status });
  };
  const pauses = [];
  const discord = createDiscordWebhook({
    fetch,
    pause: async (ms) => {
      pauses.push(ms);
    },
  });
  return { calls, pauses, discord };
}

function setup(script = [], { now = Date.parse("2026-10-10T12:00:00Z") } = {}) {
  const store = memoryStore();
  const d = fakeDiscord(script);
  const logged = [];
  const log = {
    log: (...a) => logged.push(a.join(" ")),
    error: (...a) => logged.push(a.join(" ")),
  };
  const work = createTimelineDiscordWorker({
    discord: d.discord,
    store,
    open,
    now: () => now,
    log,
  });
  let seq = 0;
  const deliver = async (posts, { webhook = seal(HOOK, ACCOUNT) } = {}) => {
    const key = `timeline-discord/${ACCOUNT}.${(seq += 1)}.json`;
    store.objects.set(key, {
      body: { v: 1, kind: "timeline", account_id: ACCOUNT, webhook, posts },
      etag: '"o"',
    });
    try {
      await work({ bucket: BUCKET, key });
      return { key, retry: null };
    } catch (err) {
      return { key, retry: err.message };
    }
  };
  return { store, ...d, deliver, logged };
}

const state = (store, item = ITEM) =>
  store.objects.get(timelineDiscordStateKey(ACCOUNT, FP, item))?.body;
const status = (store) =>
  store.objects.get(timelineDiscordStatusKey(ACCOUNT))?.body;

test("a line is posted once, without previews or pings, then edited in place as it grows", async () => {
  const s = setup();
  const first = await s.deliver([
    { key: ITEM, revision: 2, content: "five battles, still going" },
  ]);
  assert.equal(first.retry, null);
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].method, "POST");
  assert.equal(s.calls[0].url, `${HOOK}?wait=true`);
  assert.deepEqual(s.calls[0].body, {
    content: "five battles, still going",
    allowed_mentions: { parse: [] },
    flags: 4,
  });
  assert.deepEqual(state(s.store), {
    message_id: "987654321098761001",
    revision: 2,
  });
  assert.equal(
    s.store.objects.has(first.key),
    false,
    "the outbox object is deleted",
  );
  assert.equal(status(s.store).state, "ok");
  assert.equal(status(s.store).webhook, FP);

  // The same line again (a duplicate notification, a repeated sync) is
  // already told.
  await s.deliver([
    { key: ITEM, revision: 2, content: "five battles, still going" },
  ]);
  assert.equal(s.calls.length, 1);

  await s.deliver([
    { key: ITEM, revision: 4, content: "ten battles, still going" },
  ]);
  assert.equal(s.calls.length, 2);
  assert.equal(s.calls[1].method, "PATCH");
  assert.equal(s.calls[1].url, `${HOOK}/messages/987654321098761001`);
  assert.equal(s.calls[1].body.flags, 4);
  assert.deepEqual(state(s.store), {
    message_id: "987654321098761001",
    revision: 4,
  });

  // An older revision arriving late never rolls the message back.
  await s.deliver([{ key: ITEM, revision: 3, content: "eight battles" }]);
  assert.equal(s.calls.length, 2);
  assert.ok(
    s.logged.every((l) => !l.includes(TOKEN)),
    "the webhook is never logged",
  );
});

test("a line deleted in the channel stays deleted", async () => {
  const s = setup([
    { status: 200 },
    { status: 404, body: { code: 10008, message: "Unknown Message" } },
  ]);
  await s.deliver([{ key: ITEM, revision: 2, content: "a" }]);
  const out = await s.deliver([{ key: ITEM, revision: 4, content: "b" }]);
  assert.equal(out.retry, null);
  await s.deliver([{ key: ITEM, revision: 6, content: "c" }]);
  assert.deepEqual(
    s.calls.map((c) => c.method),
    ["POST", "PATCH"],
  );
  assert.equal(state(s.store).deleted, true);
});

test("a webhook Discord says is gone or refused stops the batch and tells the sync", async () => {
  for (const answer of [
    { status: 404, body: { code: 10015, message: "Unknown Webhook" } },
    { status: 401, body: { code: 50027 } },
  ]) {
    const s = setup([answer]);
    const out = await s.deliver([
      { key: ITEM, revision: 1, content: "a" },
      { key: "tl_aaaaaaaaaaaaaaaaaaaa", revision: 1, content: "b" },
    ]);
    assert.equal(out.retry, null, "not retried");
    assert.equal(s.store.objects.has(out.key), false);
    assert.equal(s.calls.length, 1, "the rest of the batch is dropped");
    assert.equal(status(s.store).state, "gone");
    assert.equal(status(s.store).http_status, answer.status);
    assert.equal(state(s.store), undefined, "the claim is freed");
    assert.ok(s.logged.some((l) => l.includes("timeline_discord_refused")));
    assert.ok(s.logged.every((l) => !l.includes(TOKEN)));
  }
});

test("any other refusal is recorded as failing and dropped", async () => {
  const s = setup([{ status: 400, body: { code: 50035 } }]);
  const out = await s.deliver([{ key: ITEM, revision: 1, content: "a" }]);
  assert.equal(out.retry, null);
  assert.equal(status(s.store).state, "failing");
  assert.equal(state(s.store), undefined);
});

test("a short rate limit is waited out; a long one goes back to the queue with the claim freed", async () => {
  const short = setup([
    { status: 429, body: { retry_after: 0.5 } },
    { status: 200 },
  ]);
  const ok = await short.deliver([{ key: ITEM, revision: 1, content: "a" }]);
  assert.equal(ok.retry, null);
  assert.deepEqual(short.pauses, [500]);
  assert.equal(state(short.store).revision, 1);

  const s = setup([{ status: 429, body: { retry_after: 60 } }]);
  const out = await s.deliver([{ key: ITEM, revision: 1, content: "a" }]);
  assert.equal(out.retry, "timeline_discord_rate_limited");
  assert.ok(s.store.objects.has(out.key), "the object waits for the retry");
  assert.equal(state(s.store), undefined, "nothing claimed");
});

test("a post whose outcome is unknown is never made again", async () => {
  for (const answer of [{ throws: true }, { status: 502, body: {} }]) {
    const s = setup([answer]);
    const out = await s.deliver([{ key: ITEM, revision: 1, content: "a" }]);
    assert.equal(out.retry, null);
    assert.deepEqual(state(s.store), { unknown: true, revision: 1 });
    // Nor edited: there is no message to edit.
    await s.deliver([{ key: ITEM, revision: 3, content: "b" }]);
    assert.equal(s.calls.length, 1);
    assert.ok(s.logged.every((l) => !l.includes(TOKEN)));
  }
});

test("an edit Discord could not answer goes back to the queue: it says the same thing twice", async () => {
  const s = setup([{ status: 200 }, { status: 503, body: {} }]);
  await s.deliver([{ key: ITEM, revision: 1, content: "a" }]);
  const out = await s.deliver([{ key: ITEM, revision: 3, content: "b" }]);
  assert.equal(out.retry, "timeline_discord_discord_error");
  assert.deepEqual(state(s.store), {
    message_id: "987654321098761001",
    revision: 1,
  });
});

test("a post another copy is sending waits; a stale claim settles as unknown, never a second post", async () => {
  const now = Date.parse("2026-10-10T12:00:00Z");
  const s = setup([], { now });
  const key = timelineDiscordStateKey(ACCOUNT, FP, ITEM);
  s.store.objects.set(key, {
    body: { pending: true, revision: 1, at: now - 30_000 },
    etag: '"p"',
  });
  let out = await s.deliver([{ key: ITEM, revision: 1, content: "a" }]);
  assert.equal(out.retry, "timeline_discord_post_in_flight");
  assert.equal(s.calls.length, 0);

  s.store.objects.set(key, {
    body: { pending: true, revision: 1, at: now - 5 * 60_000 },
    etag: '"p"',
  });
  out = await s.deliver([{ key: ITEM, revision: 1, content: "a" }]);
  assert.equal(out.retry, null);
  assert.equal(s.calls.length, 0);
  assert.equal(state(s.store).unknown, true);
});

test("anything but a sealed timeline batch for its own account is refused", async () => {
  const s = setup();
  // A bare address, and a box sealed for another account.
  const bare = await s.deliver([{ key: ITEM, revision: 1, content: "a" }], {
    webhook: HOOK,
  });
  assert.equal(bare.retry, "timeline_discord_bad_message");
  const other = await s.deliver([{ key: ITEM, revision: 1, content: "a" }], {
    webhook: seal(HOOK, "1b6b5a59-0e4f-4f39-9d55-58e41b6a3e7a"),
  });
  assert.equal(other.retry, "timeline_discord_bad_message");
  assert.equal(s.calls.length, 0);
  assert.ok(s.logged.every((l) => !l.includes(TOKEN)));
});

test("past its time budget a run starts no new line; the retry skips what was told", async () => {
  const store = memoryStore();
  const d = fakeDiscord([]);
  let t = Date.parse("2026-10-10T12:00:00Z");
  const work = createTimelineDiscordWorker({
    discord: d.discord,
    store,
    open,
    now: () => t,
    log: { log() {}, error() {} },
    budgetMs: 1000,
  });
  const key = `timeline-discord/${ACCOUNT}.budget.json`;
  const posts = ["a", "b", "c"].map((c, i) => ({
    key: `tl_${String(i).repeat(20)}`,
    revision: 1,
    content: c,
  }));
  store.objects.set(key, {
    body: {
      v: 1,
      kind: "timeline",
      account_id: ACCOUNT,
      webhook: seal(HOOK, ACCOUNT),
      posts,
    },
    etag: '"o"',
  });
  const slow = d.discord.post;
  d.discord.post = async (...a) => {
    t += 600;
    return slow(...a);
  };
  await assert.rejects(work({ bucket: BUCKET, key }), /time_budget/);
  assert.equal(d.calls.length, 2);
  assert.ok(store.objects.has(key), "the object waits for the retry");
  await work({ bucket: BUCKET, key });
  assert.deepEqual(
    d.calls.map((c) => c.body.content),
    ["a", "b", "c"],
  );
});
