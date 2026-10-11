import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryLedger } from "@elixir-mcp/clan-state";
import {
  createDiscordBridge,
  createDiscordWorker,
  discordRequestKey,
  discordReplyKey,
  discordClaimKey,
  discordOpClaimKey,
} from "../src/discord-bridge.mjs";
import { createDiscordWebhook, parseWebhook } from "../src/discord-webhook.mjs";
import { createDiscordService, PER_SWEEP } from "../src/manage/discord.mjs";
import { createHandler } from "../src/handler.mjs";
import { clanDiscordWake } from "../src/discord-wake.mjs";
import {
  createTestAccount,
  cookieHeader,
  fakeMcp,
  player,
  req,
  rosterBody,
  signIn,
} from "./fakes.mjs";

const SECRET = "test-sealing-secret-0123456789abcdef";
const TOKEN = "a".repeat(68);
const HOOK = `https://discord.com/api/webhooks/123456789012345678/${TOKEN}`;
const CLAN = "#2PQRJ8LV";
const LEAD = { player_tag: "#L", name: "Lead", role: "leader" };

function memory() {
  const objects = new Map();
  return {
    objects,
    async get(k) {
      return objects.get(k) ?? null;
    },
    async put(k, text) {
      if (objects.has(k)) return false;
      objects.set(k, text);
      return true;
    },
  };
}

/** Discord as a fake: every message it took, and every edit. */
function fakeDiscord() {
  const messages = new Map();
  let next = 900000000000000000n;
  return {
    messages,
    calls: [],
    opts: [],
    async post(url, content, opts = {}) {
      this.calls.push(["post", content]);
      this.opts.push(opts);
      const id = String(next++);
      messages.set(id, content);
      return { ok: true, status: 200, message_id: id, name: "Clan hook" };
    },
    async edit(url, id, content, opts = {}) {
      this.calls.push(["edit", content]);
      this.opts.push(opts);
      if (!messages.has(id))
        return { ok: false, status: 404, code: "message_gone" };
      messages.set(id, content);
      return { ok: true, status: 200, message_id: id };
    },
  };
}

/** The VPC side and the relay, over one in-memory outbox; `relay()`
 *  works every request not yet answered, as S3 notifications would. */
function world({
  discord = fakeDiscord(),
  clock = { t: Date.UTC(2026, 9, 10) },
} = {}) {
  const storage = memory();
  const now = () => clock.t;
  const bridge = createDiscordBridge({
    secret: SECRET,
    storage,
    now,
    pause: async (ms) => {
      clock.t += ms;
      await relay();
    },
  });
  const waits = [];
  const worker = createDiscordWorker({
    secret: SECRET,
    storage,
    discord,
    now,
    // The worker's spacing moves the clock; nothing really waits.
    pause: async (ms) => {
      waits.push(ms);
      clock.t += ms;
    },
    log: { log() {} },
  });
  async function relay() {
    for (const key of [...storage.objects.keys()])
      if (key.includes("/request/")) await worker(key);
  }
  const ledger = createMemoryLedger();
  const wakes = [];
  const service = createDiscordService({
    ledger,
    bridge,
    secret: SECRET,
    appUrl: "https://elixir.test/clan",
    now,
    waitMs: () => 5000,
    wake: async (tag) => void wakes.push(tag),
    log: { error() {} },
  });
  return {
    storage,
    bridge,
    worker,
    relay,
    ledger,
    service,
    discord,
    clock,
    waits,
    wakes,
  };
}

const card = (n, extra = {}) => ({
  card_id: `c${n}`,
  number: n,
  type: "promotion",
  status: "proposed",
  raised_at: `2026-10-10T0${n % 10}:00:00.000Z`,
  player_tag: `#P${n}`,
  player_name: `Member ${n}`,
  ...extra,
});

test("a pasted webhook is taken in its one spelling; anything else is refused", () => {
  assert.equal(parseWebhook(`${HOOK}/`)?.url, HOOK);
  assert.equal(
    parseWebhook(
      `https://canary.discordapp.com/api/v10/webhooks/123456789012345678/${TOKEN}`,
    )?.url,
    HOOK,
  );
  for (const bad of [
    `${HOOK}?thread_id=1`,
    `http://discord.com/api/webhooks/123456789012345678/${TOKEN}`,
    `https://evil.example/api/webhooks/123456789012345678/${TOKEN}`,
    "https://discord.com/api/webhooks/1/short",
    "",
  ])
    assert.equal(parseWebhook(bad), null, bad);
});

test("the webhook client allows no mentions or previews, waits out a 429, and never retries an unknown outcome", async () => {
  const seen = [];
  let answers = [
    { status: 429, body: { retry_after: 0.5 } },
    {
      status: 200,
      body: { id: "111111111111111111", author: { username: "Hook" } },
    },
  ];
  const client = createDiscordWebhook({
    pause: async () => {},
    fetch: async (url, init) => {
      seen.push([url, init.method, JSON.parse(init.body)]);
      const a = answers.shift();
      if (!a) throw new Error("socket hang up");
      return { ok: a.status < 300, status: a.status, json: async () => a.body };
    },
  });
  const r = await client.post(HOOK, "hello");
  assert.deepEqual(
    { ok: r.ok, message_id: r.message_id, name: r.name },
    { ok: true, message_id: "111111111111111111", name: "Hook" },
  );
  assert.equal(seen.length, 2);
  assert.equal(seen[0][0], `${HOOK}?wait=true`);
  assert.deepEqual(seen[0][2].allowed_mentions, { parse: [] });
  assert.equal(seen[0][2].flags, 4);
  assert.deepEqual(await client.post(HOOK, "again"), {
    ok: false,
    status: 0,
    code: "outcome_unknown",
  });
  assert.equal(seen.length, 3, "a lost answer is not tried again");
  answers = [{ status: 404, body: { code: 10015 } }];
  assert.equal(
    (await client.edit(HOOK, "111111111111111111", "x")).code,
    "webhook_gone",
  );
  assert.equal(seen.at(-1)[0], `${HOOK}/messages/111111111111111111`);
  assert.equal(seen.at(-1)[1], "PATCH");
});

test("a forum channel gets a post of its own, named; edits find it in its thread; Discord's words come back", async () => {
  const seen = [];
  let answers = [
    {
      status: 400,
      body: {
        code: 220001,
        message:
          "Webhooks posted to forum channels must have a thread_name or thread_id",
      },
    },
    {
      status: 200,
      body: { id: "222222222222222222", channel_id: "333333333333333333" },
    },
  ];
  const client = createDiscordWebhook({
    pause: async () => {},
    fetch: async (url, init) => {
      seen.push([url, init.method, JSON.parse(init.body)]);
      const a = answers.shift();
      return { ok: a.status < 300, status: a.status, json: async () => a.body };
    },
  });
  const r = await client.post(HOOK, "**Promote Ana**", {
    thread_name: "Promote  Ana\nto Elder",
    mention_role: "444444444444444444",
  });
  assert.equal(r.ok, true);
  assert.equal(r.forum, true);
  assert.equal(r.thread_id, "333333333333333333");
  assert.equal(seen.length, 2, "the plain message first, then the forum post");
  assert.equal(seen[1][2].thread_name, "Promote Ana to Elder");
  assert.deepEqual(seen[1][2].allowed_mentions, {
    parse: [],
    roles: ["444444444444444444"],
  });
  // Known to be a forum: straight to the post.
  answers = [{ status: 200, body: { id: "5", channel_id: "6" } }];
  await client.post(HOOK, "x", { thread_name: "X", forum: true });
  assert.equal(seen.length, 3);
  assert.equal(seen[2][2].thread_name, "X");
  // A role id that is not one is never sent.
  answers = [{ status: 200, body: { id: "7" } }];
  await client.post(HOOK, "y", { mention_role: "everyone" });
  assert.deepEqual(seen[3][2].allowed_mentions, { parse: [] });
  // An edit never pings, and goes to the post's thread.
  answers = [{ status: 200, body: { id: "222222222222222222" } }];
  await client.edit(HOOK, "222222222222222222", "~~done~~", {
    thread_id: "333333333333333333",
  });
  assert.equal(
    seen[4][0],
    `${HOOK}/messages/222222222222222222?thread_id=333333333333333333`,
  );
  assert.deepEqual(seen[4][2].allowed_mentions, { parse: [] });
  // Without a name a forum's refusal is the answer, in Discord's words.
  answers = [
    {
      status: 400,
      body: {
        code: 220001,
        message:
          "Webhooks posted to forum channels must have a thread_name or thread_id",
      },
    },
  ];
  const plain = await client.post(HOOK, "z");
  assert.equal(plain.code, "forum_needs_thread");
  assert.equal(plain.discord_code, 220001);
  assert.match(plain.reason, /forum channels/);
  // A long rate limit is handed back with its wait.
  answers = [{ status: 429, body: { retry_after: 42 } }];
  const busy = await client.post(HOOK, "w");
  assert.equal(busy.code, "rate_limited");
  assert.equal(busy.retry_after_ms, 42_000);
});

test("a redelivered request posts once, and the payloads in the outbox are sealed", async () => {
  const w = world();
  const sent = await w.bridge.send({
    method: "post",
    url: HOOK,
    // Spaces and punctuation never occur in base64, so the sealed box
    // cannot contain it by chance (a bare "hi" sometimes did).
    content: "A sealed line, hi!",
  });
  assert.ok(sent.ok);
  const text = w.storage.objects.get(discordRequestKey(sent.id));
  assert.ok(!text.includes(TOKEN) && !text.includes("A sealed line, hi!"));
  await w.worker(discordRequestKey(sent.id));
  await w.worker(discordRequestKey(sent.id));
  assert.equal(w.discord.calls.length, 1);
  const reply = await w.bridge.reply(sent.id);
  assert.equal(reply.ok, true);
  assert.ok(!w.storage.objects.get(discordReplyKey(sent.id)).includes(TOKEN));
});

test("a claim with no reply waits a minute, then is answered unknown and never called again", async () => {
  const w = world();
  const sent = await w.bridge.send({
    method: "post",
    url: HOOK,
    content: "hi",
  });
  await w.storage.put(
    discordClaimKey(sent.id),
    JSON.stringify({ at: w.clock.t }),
  );
  await assert.rejects(w.worker(discordRequestKey(sent.id)), /pending/);
  w.clock.t += 61_000;
  await w.worker(discordRequestKey(sent.id));
  assert.equal(w.discord.calls.length, 0);
  assert.equal((await w.bridge.reply(sent.id)).code, "outcome_unknown");
});

test("an expired request is never sent", async () => {
  const w = world();
  const sent = await w.bridge.send({
    method: "post",
    url: HOOK,
    content: "hi",
  });
  w.clock.t += 3600_001;
  await w.worker(discordRequestKey(sent.id));
  assert.equal(w.discord.calls.length, 0);
  assert.equal((await w.bridge.reply(sent.id)).code, "expired");
});

test("connecting posts a message first and keeps the webhook sealed; only leaders may", async () => {
  const w = world();
  await assert.rejects(
    w.service.setWebhook(CLAN, { ...LEAD, role: "elder" }, { url: HOOK }),
    { code: "leaders_only" },
  );
  await assert.rejects(w.service.setWebhook(CLAN, LEAD, { url: "nope" }), {
    code: "not_a_webhook",
  });
  const r = await w.service.setWebhook(CLAN, LEAD, {
    url: HOOK,
    clanName: "Example",
  });
  assert.deepEqual(r, { ok: true, name: "Clan hook", forum: false });
  assert.match(w.discord.calls[0][1], /Example's Actions here/);
  const stored = w.ledger.items.get(`discord#${CLAN}`);
  assert.ok(!JSON.stringify(stored).includes(TOKEN));
  assert.equal(stored.gsi1pk, undefined, "never in a listing of the clan");
  const status = await w.service.status(CLAN, LEAD);
  assert.equal(status.set, true);
  assert.equal(status.hint, "webhook …5678");
  assert.equal(status.readable, true);
  assert.ok(!JSON.stringify(status).includes(TOKEN));
});

test("Discord's refusal keeps nothing", async () => {
  const discord = fakeDiscord();
  discord.post = async () => ({ ok: false, status: 404, code: "webhook_gone" });
  const w = world({ discord });
  await assert.rejects(w.service.setWebhook(CLAN, LEAD, { url: HOOK }), {
    code: "webhook_refused",
  });
  assert.equal((await w.service.summary(CLAN)).set, false);
});

test("open Actions are posted; closing one edits its message to say how and by whom", async () => {
  const w = world();
  await w.service.setWebhook(CLAN, LEAD, { url: HOOK });
  w.discord.calls.length = 0;
  await w.ledger.putCard(CLAN, card(1));
  await w.ledger.putCard(CLAN, card(2, { status: "done" }));
  await w.ledger.putCard(CLAN, card(3, { type: "away", audience: undefined }));
  assert.deepEqual(await w.service.share(CLAN), { shared: 1 });
  await w.relay();
  assert.deepEqual(w.discord.calls, [
    [
      "post",
      "**#1 Promote to Elder: Member 1**\n<https://elixir.test/clan/2PQRJ8LV/actions/1>",
    ],
  ]);
  // Nothing new: the answer is collected and nothing is sent again.
  assert.deepEqual(await w.service.share(CLAN), { shared: 0 });
  const post = (await w.ledger.discordPosts(CLAN))[0];
  assert.ok(post.message_id);
  await w.ledger.putCard(
    CLAN,
    card(1, { status: "done", decided_by: "#L", decided_by_name: "Lead" }),
  );
  assert.deepEqual(await w.service.share(CLAN), { shared: 1 });
  await w.relay();
  assert.equal(w.discord.calls.at(-1)[0], "edit");
  assert.equal(
    w.discord.messages.get(post.message_id),
    "~~**#1 Promote to Elder: Member 1**~~\n✅ Completed by Lead\n<https://elixir.test/clan/2PQRJ8LV/actions/1>",
  );
  assert.deepEqual(await w.service.share(CLAN), { shared: 0 });
  assert.equal(w.discord.calls.length, 2);
});

test("an Action closed before its post was answered is edited once the id arrives", async () => {
  const w = world();
  await w.service.setWebhook(CLAN, LEAD, { url: HOOK });
  await w.ledger.putCard(CLAN, card(1));
  await w.service.share(CLAN);
  await w.ledger.putCard(CLAN, card(1, { status: "withdrawn" }));
  // The relay has not answered: nothing more is handed over yet.
  assert.deepEqual(await w.service.share(CLAN), { shared: 0, waiting: 1 });
  await w.relay();
  assert.deepEqual(await w.service.share(CLAN), { shared: 1 });
  await w.relay();
  assert.match(w.discord.calls.at(-1)[1], /Withdrawn/);
});

test("a sweep hands over at most PER_SWEEP; the rest wait for the next", async () => {
  const w = world();
  await w.service.setWebhook(CLAN, LEAD, { url: HOOK });
  for (let n = 1; n <= PER_SWEEP + 3; n++)
    await w.ledger.putCard(CLAN, card(n));
  assert.equal((await w.service.share(CLAN)).shared, PER_SWEEP);
  // One hand-off at a time: the next waits for its answers.
  assert.deepEqual(await w.service.share(CLAN), {
    shared: 0,
    waiting: PER_SWEEP,
  });
  await w.relay();
  assert.equal((await w.service.share(CLAN)).shared, 3);
  await w.relay();
  // In Action number order, spaced, never faster than Discord's pace.
  assert.deepEqual(
    w.discord.calls.slice(1).map(([, text]) => Number(/#(\d+)/.exec(text)[1])),
    Array.from({ length: PER_SWEEP + 3 }, (_, i) => i + 1),
  );
  assert.ok(
    w.waits.length >= PER_SWEEP + 1 && w.waits.every((ms) => ms <= 2400),
  );
});

test("a post with an unknown outcome is never made again; a gone webhook stops everything", async () => {
  const discord = fakeDiscord();
  const w = world({ discord });
  await w.service.setWebhook(CLAN, LEAD, { url: HOOK });
  discord.post = async () => ({
    ok: false,
    status: 0,
    code: "outcome_unknown",
  });
  await w.ledger.putCard(CLAN, card(1));
  await w.service.share(CLAN);
  await w.relay();
  assert.deepEqual(await w.service.share(CLAN), { shared: 0 });
  discord.post = async () => ({ ok: false, status: 404, code: "webhook_gone" });
  await w.ledger.putCard(CLAN, card(2));
  assert.deepEqual(await w.service.share(CLAN), { shared: 1 });
  await w.relay();
  assert.equal((await w.service.share(CLAN)).reason, "refused");
  assert.equal((await w.service.summary(CLAN)).refused, true);
  assert.ok((await w.service.status(CLAN, LEAD)).refused_at);
});

test("removing the webhook forgets its messages; a new one starts over", async () => {
  const w = world();
  await w.service.setWebhook(CLAN, LEAD, { url: HOOK });
  await w.ledger.putCard(CLAN, card(1));
  await w.service.share(CLAN);
  await w.relay();
  await w.service.share(CLAN);
  await w.service.removeWebhook(CLAN, LEAD);
  assert.deepEqual(await w.ledger.discordPosts(CLAN), []);
  assert.deepEqual(await w.service.share(CLAN), { shared: 0 });
  await w.service.setWebhook(CLAN, LEAD, { url: HOOK });
  assert.deepEqual(await w.service.share(CLAN), { shared: 1 });
});

test("the routes: leaders connect, read and remove; a member is refused; the address never comes back", async () => {
  const w = world();
  const ADA = player();
  const BEN = player({ player_tag: "#8QCV", name: "Ben", clan_role: "member" });
  const mcp = fakeMcp({
    players: [ADA],
    roster: rosterBody(
      [ADA, BEN].map((m) => ({
        player_tag: m.player_tag,
        name: m.name,
        role: m.clan_role,
      })),
    ),
  });
  const handler = createHandler({
    mcp,
    ...createTestAccount(),
    discord: w.service,
    appUrl: "https://elixir.test/clan",
    elixirUrl: "https://elixir.test",
    log: { warn() {}, error() {} },
  });
  const as = async (who) => {
    mcp.state.players = [who];
    const { sessionCookie } = await signIn({ handler });
    const cookies = cookieHeader(sessionCookie);
    return async (method, path, body) => {
      const r = await handler(
        req(method, path, {
          cookies,
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
      return { status: r.statusCode, body: JSON.parse(r.body), raw: r.body };
    };
  };
  const path = "/api/clans/2PQRJ8LV/discord";
  const ben = await as(BEN);
  assert.equal((await ben("GET", path)).status, 403);
  assert.equal((await ben("PUT", path, { url: HOOK })).status, 403);
  assert.equal(
    (await ben("POST", `${path}/mention`, { role_id: "444444444444444444" }))
      .status,
    403,
  );
  const ada = await as(ADA);
  assert.equal((await ada("GET", path)).body.set, false);
  const bad = await ada("PUT", path, { url: "https://example.com/x" });
  assert.equal(bad.status, 400);
  assert.match(bad.body.message, /discord\.com\/api\/webhooks/);
  const set = await ada("PUT", path, { url: HOOK });
  assert.equal(set.status, 200, set.raw);
  assert.match(w.discord.calls[0][1], /Example Clan's Actions here/);
  const read = await ada("GET", path);
  assert.equal(read.body.set, true);
  assert.ok(!read.raw.includes(TOKEN));
  const role = await ada("POST", `${path}/mention`, {
    role_id: "444444444444444444",
  });
  assert.equal(role.status, 200, role.raw);
  assert.equal(
    (await ada("GET", path)).body.mention_role,
    "444444444444444444",
  );
  assert.equal(
    (await ada("POST", `${path}/mention`, { role_id: "x" })).status,
    400,
  );
  assert.equal((await ada("DELETE", path)).status, 200);
  assert.equal((await ada("GET", path)).body.set, false);
});

test("a worker that stops part way is picked up where it stopped: the op it was calling is unknown, the rest still go", async () => {
  const w = world();
  await w.service.setWebhook(CLAN, LEAD, { url: HOOK });
  w.discord.calls.length = 0;
  for (let n = 1; n <= 3; n++) await w.ledger.putCard(CLAN, card(n));
  await w.service.share(CLAN);
  const key = [...w.storage.objects.keys()].find(
    (k) =>
      k.includes("/request/") &&
      !w.storage.objects.has(k.replace("/request/", "/reply/")),
  );
  const id = /request\/(.+)\.json$/.exec(key)[1];
  // A worker was calling #2 when it stopped: its claim is there, its
  // answer never came.
  await w.storage.put(
    discordOpClaimKey(id, 1),
    JSON.stringify({ at: w.clock.t }),
  );
  await assert.rejects(w.worker(key), /pending/);
  assert.equal(w.discord.calls.length, 1, "#1 goes; #2's claim is fresh");
  w.clock.t += 61_000;
  await w.worker(key);
  assert.deepEqual(
    w.discord.calls.map(([, t]) => /#(\d)/.exec(t)[1]),
    ["1", "3"],
    "#2 is unknown, never sent again; #3 still goes",
  );
  await w.service.share(CLAN);
  const posts = await w.ledger.discordPosts(CLAN);
  const two = posts.find((p) => p.card_id === "c2");
  assert.equal(two.gave_up, true);
  assert.equal(two.error, "outcome_unknown");
  assert.deepEqual(await w.service.share(CLAN), { shared: 0 });
  const status = await w.service.status(CLAN, LEAD);
  assert.deepEqual(
    status.deliveries
      .slice(0, 3)
      .map((d) => [d.ref, d.outcome])
      .sort(),
    [
      ["#1", "posted"],
      ["#2", "unknown"],
      ["#3", "posted"],
    ],
  );
  assert.equal(status.not_delivered, 1);
});

test("the request's id is kept before it is in the outbox: a hand-off that never arrived is never posted twice (#453)", async () => {
  const w = world();
  await w.service.setWebhook(CLAN, LEAD, { url: HOOK });
  w.discord.calls.length = 0;
  await w.ledger.putCard(CLAN, card(1));
  const put = w.storage.put;
  w.storage.put = async (k, text) => {
    if (k.includes("/request/")) throw new Error("timed out");
    return put(k, text);
  };
  assert.deepEqual(await w.service.share(CLAN), { shared: 0 });
  w.storage.put = put;
  const [post] = await w.ledger.discordPosts(CLAN);
  assert.ok(post.request_id, "reserved first");
  assert.deepEqual(await w.service.share(CLAN), { shared: 0, waiting: 1 });
  // An hour on, with no answer, it is unknown: never sent again.
  w.clock.t += 3600_001;
  assert.deepEqual(await w.service.share(CLAN), { shared: 0 });
  assert.equal(w.discord.calls.length, 0);
  assert.equal((await w.ledger.discordPosts(CLAN))[0].gave_up, true);
});

test("each hand-off wakes a look a minute on, until its answers are in", async () => {
  const w = world();
  await w.service.setWebhook(CLAN, LEAD, { url: HOOK });
  await w.ledger.putCard(CLAN, card(1));
  await w.service.share(CLAN);
  assert.deepEqual(w.wakes, [CLAN]);
  await w.service.share(CLAN);
  assert.deepEqual(w.wakes, [CLAN, CLAN], "still unanswered: look again");
  await w.relay();
  await w.service.share(CLAN);
  assert.equal(w.wakes.length, 2, "answered and nothing new: no wake");
});

test("a forum channel: each Action is a post of its own, named for it, and its close is edited inside it", async () => {
  const discord = fakeDiscord();
  const real = discord.post.bind(discord);
  discord.post = async (url, content, opts = {}) => {
    const r = await real(url, content, opts);
    return opts.thread_name
      ? { ...r, forum: true, thread_id: `7${r.message_id.slice(1)}` }
      : r;
  };
  const w = world({ discord });
  assert.deepEqual(await w.service.setWebhook(CLAN, LEAD, { url: HOOK }), {
    ok: true,
    name: "Clan hook",
    forum: true,
  });
  assert.equal(w.discord.opts[0].thread_name, "Elixir Clan Actions");
  assert.equal((await w.service.status(CLAN, LEAD)).forum, true);
  await w.ledger.putCard(CLAN, card(1, { player_name: "*Ana*" }));
  await w.service.share(CLAN);
  await w.relay();
  assert.equal(w.discord.opts[1].thread_name, "#1 Promote to Elder: *Ana*");
  assert.equal(w.discord.opts[1].forum, true, "known to be a forum");
  await w.service.share(CLAN);
  const [post] = await w.ledger.discordPosts(CLAN);
  assert.ok(post.thread_id);
  await w.ledger.putCard(
    CLAN,
    card(1, { status: "declined", decided_by: "#L", decided_by_name: "Lead" }),
  );
  await w.service.share(CLAN);
  await w.relay();
  assert.equal(w.discord.calls.at(-1)[0], "edit");
  assert.deepEqual(w.discord.opts.at(-1), { thread_id: post.thread_id });
});

test("a role a leader chose is mentioned on each new Action, never on its edit", async () => {
  const w = world();
  await w.service.setWebhook(CLAN, LEAD, { url: HOOK });
  await assert.rejects(
    w.service.setMentionRole(CLAN, LEAD, { role_id: "@everyone" }),
    { code: "not_a_role" },
  );
  await assert.rejects(
    w.service.setMentionRole(
      CLAN,
      { ...LEAD, role: "elder" },
      {
        role_id: "444444444444444444",
      },
    ),
    { code: "leaders_only" },
  );
  await w.service.setMentionRole(CLAN, LEAD, {
    role_id: "444444444444444444",
  });
  assert.equal(
    (await w.service.status(CLAN, LEAD)).mention_role,
    "444444444444444444",
  );
  await w.ledger.putCard(CLAN, card(1));
  await w.service.share(CLAN);
  await w.relay();
  assert.match(w.discord.calls.at(-1)[1], /^<@&444444444444444444> \*\*#1 /);
  assert.equal(w.discord.opts.at(-1).mention_role, "444444444444444444");
  await w.service.share(CLAN);
  await w.ledger.putCard(CLAN, card(1, { status: "withdrawn" }));
  await w.service.share(CLAN);
  await w.relay();
  assert.equal(w.discord.calls.at(-1)[0], "edit");
  assert.doesNotMatch(w.discord.calls.at(-1)[1], /<@&/);
  // The same webhook again keeps the role; another may be another
  // server, where that role is nothing, so it is cleared.
  await w.service.setWebhook(CLAN, LEAD, { url: HOOK });
  assert.equal(
    (await w.service.status(CLAN, LEAD)).mention_role,
    "444444444444444444",
  );
  await w.service.setWebhook(CLAN, LEAD, {
    url: HOOK.replace("123456789012345678", "223456789012345678"),
  });
  assert.equal((await w.service.status(CLAN, LEAD)).mention_role, null);
  // Off again.
  await w.service.setMentionRole(CLAN, LEAD, {
    role_id: "444444444444444444",
  });
  await w.service.setMentionRole(CLAN, LEAD, { role_id: null });
  assert.equal((await w.service.status(CLAN, LEAD)).mention_role, null);
});

test("Discord refusing one Action's post skips that one, says why, and the rest still go", async () => {
  const discord = fakeDiscord();
  const real = discord.post.bind(discord);
  discord.post = async (url, content, opts) =>
    /#2 /.test(content)
      ? {
          ok: false,
          status: 400,
          code: "bad_request",
          reason: "Invalid Form Body: content",
        }
      : real(url, content, opts);
  const w = world({ discord });
  await w.service.setWebhook(CLAN, LEAD, { url: HOOK });
  for (let n = 1; n <= 3; n++) await w.ledger.putCard(CLAN, card(n));
  await w.service.share(CLAN);
  await w.relay();
  await w.service.share(CLAN);
  assert.deepEqual(
    w.discord.calls.slice(1).map(([, t]) => /#(\d)/.exec(t)[1]),
    ["1", "3"],
  );
  const status = await w.service.status(CLAN, LEAD);
  const two = status.deliveries.find((d) => d.ref === "#2");
  assert.equal(two.outcome, "refused");
  assert.equal(two.http_status, 400);
  assert.equal(two.reason, "Invalid Form Body: content");
  assert.equal(status.refused_at, null, "the webhook itself still works");
  assert.equal(status.not_delivered, 1);
});

test("a connect Discord refuses says what Discord said", async () => {
  const discord = fakeDiscord();
  discord.post = async () => ({
    ok: false,
    status: 400,
    code: "bad_request",
    reason: "Cannot send messages in a voice channel",
  });
  const w = world({ discord });
  await assert.rejects(w.service.setWebhook(CLAN, LEAD, { url: HOOK }), (e) => {
    assert.equal(e.status ?? e.statusCode ?? 400, 400);
    assert.equal(e.code, "discord_refused");
    assert.match(JSON.stringify(e), /Cannot send messages in a voice channel/);
    return true;
  });
});

test("the wake is one timeline-sync object a clan a minute, or none without an outbox", async () => {
  assert.equal(clanDiscordWake(null), null);
  const written = [];
  const wake = clanDiscordWake(
    async (lane, message, opts) => void written.push([lane, message, opts]),
    () => 29_340_000 * 60_000 + 59_000,
  );
  await wake(CLAN);
  assert.deepEqual(written, [
    [
      "timeline-sync",
      { v: 1, clan_discord: CLAN },
      { id: "clan-discord-2PQRJ8LV.29340000", once: true },
    ],
  ]);
});
