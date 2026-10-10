import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryLedger } from "@elixir-mcp/clan-state";
import {
  createDiscordBridge,
  createDiscordWorker,
  discordRequestKey,
  discordReplyKey,
  discordClaimKey,
} from "../src/discord-bridge.mjs";
import { createDiscordWebhook, parseWebhook } from "../src/discord-webhook.mjs";
import { createDiscordService, PER_SWEEP } from "../src/manage/discord.mjs";
import { createHandler } from "../src/handler.mjs";
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
    async post(url, content) {
      this.calls.push(["post", content]);
      const id = String(next++);
      messages.set(id, content);
      return { ok: true, status: 200, message_id: id, name: "Clan hook" };
    },
    async edit(url, id, content) {
      this.calls.push(["edit", content]);
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
  const worker = createDiscordWorker({
    secret: SECRET,
    storage,
    discord,
    now,
    log: { log() {} },
  });
  async function relay() {
    for (const key of [...storage.objects.keys()])
      if (key.includes("/request/")) await worker(key);
  }
  const ledger = createMemoryLedger();
  const service = createDiscordService({
    ledger,
    bridge,
    secret: SECRET,
    appUrl: "https://elixir.test/clan",
    now,
    waitMs: () => 5000,
    log: { error() {} },
  });
  return { storage, bridge, worker, relay, ledger, service, discord, clock };
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
  assert.deepEqual(r, { ok: true, name: "Clan hook" });
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
  assert.deepEqual(await w.service.share(CLAN), { shared: 0 });
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
  assert.equal((await w.service.share(CLAN)).shared, 3);
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
  assert.equal((await ada("DELETE", path)).status, 200);
  assert.equal((await ada("GET", path)).body.set, false);
});
