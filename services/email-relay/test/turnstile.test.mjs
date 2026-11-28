import { test } from "node:test";
import assert from "node:assert/strict";
import { makeHandler } from "../src/handler.mjs";
import {
  idempotencyKeyFor,
  makeTurnstileCheck,
  turnstileVerdictStore,
  SITEVERIFY_URL,
} from "../src/turnstile.mjs";

/** Cloudflare, faked: each token answers once, as the real siteverify
 *  does; a second ask is `timeout-or-duplicate`, unless it carries the
 *  first ask's `idempotency_key`, which gets the first answer again.
 *  A pass echoes our hostname and the `signin` action unless the answer
 *  names others: `{ hostname, action }`. */
function fakeCloudflare(answers = {}) {
  const asked = [];
  const spent = new Map();
  const fetchImpl = async (url, init) => {
    assert.equal(url, SITEVERIFY_URL);
    const form = new URLSearchParams(String(init.body));
    const token = form.get("response");
    const key = form.get("idempotency_key");
    asked.push({ token, secret: form.get("secret"), key });
    const answer = answers[token] ?? "pass";
    if (answer === "down") throw new Error("network");
    if (answer === "http500") return new Response("no", { status: 500 });
    if (answer === "badsecret")
      return Response.json({
        success: false,
        "error-codes": ["invalid-input-secret"],
      });
    if (answer === "internal")
      return Response.json({
        success: false,
        "error-codes": ["internal-error"],
      });
    if (spent.has(token)) {
      const first = spent.get(token);
      if (key && first.key === key) return Response.json(first.body);
      return Response.json({
        success: false,
        "error-codes": ["timeout-or-duplicate"],
      });
    }
    const body =
      answer === "fail"
        ? { success: false, "error-codes": ["invalid-input-response"] }
        : {
            success: true,
            hostname: "elixir.poapkings.com",
            action: "signin",
            "error-codes": [],
            ...(typeof answer === "object" ? answer : {}),
          };
    spent.set(token, { key, body });
    return Response.json(body);
  };
  return { asked, fetchImpl };
}

/** The kept verdicts, in memory, with S3's conditional writes. */
function memoryStore() {
  const objects = new Map();
  let version = 0;
  return {
    objects,
    async read(hash) {
      const o = objects.get(hash);
      return o ? { record: structuredClone(o.record), etag: o.etag } : null;
    },
    async create(hash, record) {
      if (objects.has(hash)) return false;
      objects.set(hash, { record, etag: `e${++version}` });
      return true;
    },
    async update(hash, record, etag) {
      if (objects.get(hash)?.etag !== etag) return false;
      objects.set(hash, { record, etag: `e${++version}` });
      return true;
    },
  };
}

function captureLog(t) {
  const lines = [];
  t.mock.method(console, "log", (line) => {
    try {
      const parsed = JSON.parse(line);
      if (parsed.auth?.startsWith("turnstile")) lines.push(parsed);
    } catch {
      // Not an auth line.
    }
  });
  return lines;
}

const observe = { TURNSTILE_MODE: "observe" };
const enforce = { TURNSTILE_MODE: "enforce" };

test("observe: every result is recorded and every mail may go", async (t) => {
  const log = captureLog(t);
  const cf = fakeCloudflare({ bad: "fail", gone: "down", broke: "http500" });
  const check = makeTurnstileCheck({
    secret: "s",
    store: memoryStore(),
    fetchImpl: cf.fetchImpl,
    env: observe,
  });
  const at = (token) =>
    check({ surface: "web", token, to: "A@x.com", use: `email/${token}` });
  assert.equal((await at("good")).result, "pass");
  assert.equal((await at("bad")).result, "fail");
  assert.equal((await at("")).result, "missing");
  assert.equal((await at("gone")).result, "error");
  assert.equal((await at("broke")).result, "error");
  assert.deepEqual(
    log.map((l) => [l.result, l.allowed, l.mode, l.surface]),
    [
      ["pass", true, "observe", "web"],
      ["fail", true, "observe", "web"],
      ["missing", true, "observe", "web"],
      ["error", true, "observe", "web"],
      ["error", true, "observe", "web"],
    ],
  );
  assert.equal(log[0].hostname, "elixir.poapkings.com");
  assert.equal(log[0].action, "signin");
  // The line names the address by the auth log's 8-hex ref, never the
  // address, and never the token.
  for (const line of log) {
    assert.match(line.email, /^[0-9a-f]{8}$/);
    assert.doesNotMatch(JSON.stringify(line), /A@x\.com|good|bad"/i);
  }
});

test("enforce refuses only a failed or missing token; an outage, a bad secret or no secret sends", async (t) => {
  captureLog(t);
  const cf = fakeCloudflare({
    good: { action: "oauth-signin" },
    bad: "fail",
    gone: "down",
    key: "badsecret",
    hiccup: "internal",
  });
  const check = makeTurnstileCheck({
    secret: "s",
    fetchImpl: cf.fetchImpl,
    env: enforce,
  });
  const allowed = async (token, secret = "s") =>
    (
      await (
        secret === "s"
          ? check
          : makeTurnstileCheck({
              secret,
              fetchImpl: cf.fetchImpl,
              env: enforce,
            })
      )({ surface: "oauth", token, to: "a@x.com", use: null })
    ).allowed;
  assert.equal(await allowed("good"), true);
  assert.equal(await allowed("bad"), false);
  assert.equal(await allowed(""), false);
  assert.equal(await allowed("gone"), true, "Cloudflare down");
  assert.equal(await allowed("key"), true, "our secret rejected");
  // Cloudflare's internal-error is retryable, never the visitor's.
  assert.equal(await allowed("hiccup"), true, "Cloudflare internal error");
  assert.equal(await allowed("any", null), true, "unconfigured");
});

test("no secret yet: recorded as unconfigured and Cloudflare is never asked", async (t) => {
  const log = captureLog(t);
  const cf = fakeCloudflare();
  const check = makeTurnstileCheck({
    secret: null,
    fetchImpl: cf.fetchImpl,
    env: {},
  });
  const v = await check({ surface: "web", token: "t", to: "a@x.com" });
  assert.deepEqual(
    [v.result, v.mode, v.allowed],
    ["unconfigured", "observe", true],
  );
  assert.equal(cf.asked.length, 0);
  assert.equal(log[0].result, "unconfigured");
});

test("off: nothing asked, nothing logged", async (t) => {
  const log = captureLog(t);
  const cf = fakeCloudflare();
  const v = await makeTurnstileCheck({
    secret: "s",
    fetchImpl: cf.fetchImpl,
    env: { TURNSTILE_MODE: "off" },
  })({ surface: "web", token: "t", to: "a@x.com" });
  assert.deepEqual([v.result, v.allowed], ["off", true]);
  assert.equal(cf.asked.length + log.length, 0);
});

test("one token: one address, three sends, five minutes; a retry is not a send", async (t) => {
  const log = captureLog(t);
  const cf = fakeCloudflare();
  const store = memoryStore();
  let clock = 1_800_000_000_000;
  const check = makeTurnstileCheck({
    secret: "s",
    store,
    fetchImpl: cf.fetchImpl,
    now: () => clock,
    env: enforce,
  });
  const send = (use, to = "a@x.com", token = "tok") =>
    check({ surface: "web", token, to, use });

  assert.equal((await send("email/1")).result, "pass");
  assert.equal(cf.asked.length, 1);
  // The queue retries the same object: the kept verdict, no use spent.
  const retry = await send("email/1");
  assert.deepEqual([retry.result, retry.reused], ["pass", true]);
  // "Send another email" with the same token: Cloudflare is not asked
  // again (it would say duplicate), the kept verdict answers.
  assert.equal((await send("email/2")).result, "pass");
  assert.equal((await send("email/3")).result, "pass");
  assert.equal(cf.asked.length, 1, "verified once");
  const fourth = await send("email/4");
  assert.deepEqual([fourth.result, fourth.allowed], ["fail", false]);
  assert.deepEqual(fourth.codes, ["token-used-up"]);
  // The token presented for another address fails.
  const other = await send("email/5", "b@x.com");
  assert.deepEqual(other.codes, ["token-other-address"]);
  assert.equal(other.allowed, false);
  // Nothing about the token is kept in the clear.
  for (const [hash, { record }] of store.objects) {
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.doesNotMatch(JSON.stringify(record), /tok|a@x\.com/);
  }
  // Five minutes on, the kept verdict is stale and Cloudflare decides
  // (a spent token: duplicate, so it fails).
  clock += 301_000;
  const late = await send("email/6");
  assert.deepEqual([late.result, late.reused], ["fail", false]);
  assert.deepEqual(late.codes, ["timeout-or-duplicate"]);
  assert.equal(log.filter((l) => l.reused).length, 5);
});

test("a failed verdict is kept too: a resend with the same token still fails", async (t) => {
  captureLog(t);
  const cf = fakeCloudflare({ bot: "fail" });
  const check = makeTurnstileCheck({
    secret: "s",
    store: memoryStore(),
    fetchImpl: cf.fetchImpl,
    env: observe,
  });
  const a = await check({
    surface: "web",
    token: "bot",
    to: "v@x.com",
    use: "1",
  });
  const b = await check({
    surface: "web",
    token: "bot",
    to: "v@x.com",
    use: "2",
  });
  assert.deepEqual([a.result, b.result, b.reused], ["fail", "fail", true]);
  assert.equal(cf.asked.length, 1);
});

test("two sends race on one token: the loser takes the first verdict", async (t) => {
  captureLog(t);
  const cf = fakeCloudflare();
  const store = memoryStore();
  // The other relay's verdict lands between our read and our write.
  const realRead = store.read;
  let first = true;
  store.read = async (hash) => {
    if (first) {
      first = false;
      return null;
    }
    return realRead(hash);
  };
  const realCreate = store.create;
  store.create = async (hash, record) => {
    await realCreate(hash, { ...record, uses: ["email/other"] });
    return false;
  };
  const v = await makeTurnstileCheck({
    secret: "s",
    store,
    fetchImpl: cf.fetchImpl,
    env: observe,
  })({ surface: "web", token: "t", to: "a@x.com", use: "email/mine" });
  assert.deepEqual([v.result, v.reused], ["pass", true]);
});

test("a store that fails never stops the mail", async (t) => {
  const log = captureLog(t);
  const cf = fakeCloudflare();
  const broken = {
    read: async () => {
      throw new Error("s3 down");
    },
    create: async () => {
      throw new Error("s3 down");
    },
    update: async () => {
      throw new Error("s3 down");
    },
  };
  const v = await makeTurnstileCheck({
    secret: "s",
    store: broken,
    fetchImpl: cf.fetchImpl,
    env: enforce,
  })({ surface: "web", token: "t", to: "a@x.com", use: "1" });
  assert.deepEqual([v.result, v.allowed], ["pass", true]);
  assert.deepEqual(
    log.filter((l) => l.auth === "turnstile_store_failed").map((l) => l.op),
    ["read", "create"],
  );
});

test("the S3 store: a 403 on a missing key is proved absent by an exact one-key list", async () => {
  const calls = [];
  const s3 = {
    async send(cmd) {
      const name = cmd.constructor.name;
      calls.push([name, cmd.input]);
      if (name === "GetObjectCommand")
        throw Object.assign(new Error("denied"), {
          name: "AccessDenied",
          $metadata: { httpStatusCode: 403 },
        });
      if (name === "ListObjectsV2Command")
        return { KeyCount: 0, IsTruncated: false };
      if (name === "PutObjectCommand") {
        if (cmd.input.IfMatch === "stale")
          throw Object.assign(new Error("precondition"), {
            $metadata: { httpStatusCode: 412 },
          });
        return {};
      }
      throw new Error(name);
    },
  };
  const store = turnstileVerdictStore("outbox", s3);
  const hash = "a".repeat(64);
  assert.equal(await store.read(hash), null);
  assert.deepEqual(calls[1], [
    "ListObjectsV2Command",
    {
      Bucket: "outbox",
      Prefix: `mail-delivery/turnstile/${hash}.json`,
      MaxKeys: 1,
    },
  ]);
  assert.equal(await store.create(hash, { result: "pass" }), true);
  assert.equal(calls.at(-1)[1].IfNoneMatch, "*");
  assert.equal(await store.update(hash, { result: "pass" }, "stale"), false);
});

test("the relay checks a login that carries a token: observe sends, enforce drops a failure", async (t) => {
  const log = captureLog(t);
  const objects = new Map([
    [
      "email/person.json",
      {
        v: 1,
        kind: "login",
        to: "p@x.com",
        code: "111111",
        turnstile: { surface: "web", token: "human" },
      },
    ],
    [
      "email/bot.json",
      {
        v: 1,
        kind: "login",
        to: "victim@x.com",
        code: "222222",
        turnstile: { surface: "oauth", token: "bot" },
      },
    ],
    ["email/old.json", { v: 1, kind: "login", to: "o@x.com", code: "333333" }],
  ]);
  const run = async (env) => {
    const sent = [];
    const deleted = [];
    const store = new Map(objects);
    const handler = makeHandler({
      send: async (m) => sent.push(m.to),
      readObject: async ({ key }) =>
        store.has(key) ? JSON.stringify(store.get(key)) : null,
      deleteObject: async ({ key }) => deleted.push(key),
      turnstile: makeTurnstileCheck({
        secret: "s",
        store: memoryStore(),
        fetchImpl: fakeCloudflare({ bot: "fail" }).fetchImpl,
        env,
      }),
    });
    const out = await handler({
      Records: [...store.keys()].map((key, i) => ({
        messageId: `m${i}`,
        body: JSON.stringify({
          Records: [
            {
              eventSource: "aws:s3",
              s3: { bucket: { name: "outbox" }, object: { key } },
            },
          ],
        }),
      })),
    });
    return { sent, deleted, failures: out.batchItemFailures };
  };

  const watched = await run(observe);
  assert.deepEqual(watched.sent, ["p@x.com", "victim@x.com", "o@x.com"]);
  const enforced = await run(enforce);
  assert.deepEqual(enforced.sent, ["p@x.com", "o@x.com"]);
  assert.deepEqual(enforced.failures, [], "a refusal is done, never retried");
  assert.ok(enforced.deleted.includes("email/bot.json"));
  // A login queued before the token rode the message is sent unchecked.
  assert.deepEqual(
    log.map((l) => `${l.mode}:${l.surface}:${l.result}`),
    [
      "observe:web:pass",
      "observe:oauth:fail",
      "enforce:web:pass",
      "enforce:oauth:fail",
    ],
  );
});

test("a pass counts only for our hostname and the door's own action", async (t) => {
  const log = captureLog(t);
  const cf = fakeCloudflare({
    web: {},
    oauth: { action: "oauth-signin" },
    elsewhere: { hostname: "example.com" },
    crossed: { action: "oauth-signin" },
    nohost: { hostname: undefined, action: undefined },
  });
  const check = makeTurnstileCheck({
    secret: "s",
    store: memoryStore(),
    fetchImpl: cf.fetchImpl,
    env: enforce,
  });
  const at = (surface, token) =>
    check({ surface, token, to: "a@x.com", use: `email/${token}` });
  assert.equal((await at("web", "web")).result, "pass");
  assert.equal((await at("oauth", "oauth")).result, "pass");
  const elsewhere = await at("web", "elsewhere");
  assert.deepEqual(
    [elsewhere.result, elsewhere.allowed, elsewhere.codes],
    ["fail", false, ["hostname-mismatch"]],
  );
  // The OAuth page's token presented at the website's door.
  const crossed = await at("web", "crossed");
  assert.deepEqual(crossed.codes, ["action-mismatch"]);
  const nohost = await at("oauth", "nohost");
  assert.deepEqual(nohost.codes, ["hostname-mismatch", "action-mismatch"]);
  // The line still names what Cloudflare saw.
  const line = log.find((l) => l.codes?.includes("hostname-mismatch"));
  assert.equal(line.hostname, "example.com");
  assert.equal(line.result, "fail");
});

test("a kept verdict is judged as the first was: a mismatch stays a fail, another door's token fails", async (t) => {
  captureLog(t);
  const cf = fakeCloudflare({ elsewhere: { hostname: "example.com" } });
  const store = memoryStore();
  const check = makeTurnstileCheck({
    secret: "s",
    store,
    fetchImpl: cf.fetchImpl,
    env: enforce,
  });
  const send = (surface, token, use) =>
    check({ surface, token, to: "a@x.com", use });
  assert.equal((await send("web", "elsewhere", "1")).result, "fail");
  const again = await send("web", "elsewhere", "2");
  assert.deepEqual(
    [again.result, again.reused, again.codes],
    ["fail", true, ["hostname-mismatch"]],
  );
  // A website token kept as a pass, then sent through the OAuth door.
  assert.equal((await send("web", "tok", "3")).result, "pass");
  const other = await send("oauth", "tok", "4");
  assert.deepEqual(
    [other.result, other.reused, other.codes],
    ["fail", true, ["action-mismatch"]],
  );
  assert.equal(cf.asked.length, 2, "Cloudflare asked once per token");
  // A record kept before the action was (no action field) stands as it was.
  const [hash, kept] = [...store.objects].find(
    ([, o]) => o.record.result === "pass",
  );
  delete kept.record.action;
  kept.record.uses = [];
  store.objects.set(hash, kept);
  assert.equal((await send("oauth", "tok", "5")).result, "pass");
});

test("siteverify gets the send's own idempotency key: a queue retry after a lost verdict is not a duplicate", async (t) => {
  const log = captureLog(t);
  const cf = fakeCloudflare();
  // The verdict cannot be kept (S3 down), so a retry asks Cloudflare again.
  const broken = {
    read: async () => null,
    create: async () => {
      throw new Error("s3 down");
    },
    update: async () => {
      throw new Error("s3 down");
    },
  };
  const check = makeTurnstileCheck({
    secret: "s",
    store: broken,
    fetchImpl: cf.fetchImpl,
    env: enforce,
  });
  const send = (use) =>
    check({ surface: "web", token: "person", to: "a@x.com", use });
  assert.equal((await send("email/1.json")).result, "pass");
  const retry = await send("email/1.json");
  assert.deepEqual([retry.result, retry.allowed], ["pass", true]);
  assert.equal(cf.asked.length, 2);
  assert.equal(cf.asked[0].key, cf.asked[1].key);
  // A UUID (version 5), the same for the same send, another for another.
  assert.match(
    cf.asked[0].key,
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.equal(
    idempotencyKeyFor("email/1.json", "a".repeat(64)),
    idempotencyKeyFor("email/1.json", "a".repeat(64)),
  );
  assert.notEqual(
    idempotencyKeyFor("email/1.json", "a".repeat(64)),
    idempotencyKeyFor("email/2.json", "a".repeat(64)),
  );
  // Another send of the same token is a new use: Cloudflare says duplicate.
  const resend = await send("email/2.json");
  assert.deepEqual(resend.codes, ["timeout-or-duplicate"]);
  // No send name, no key.
  await check({ surface: "web", token: "fresh", to: "a@x.com", use: null });
  assert.equal(cf.asked.at(-1).key, null);
  for (const line of log) assert.doesNotMatch(JSON.stringify(line), /person/);
});
