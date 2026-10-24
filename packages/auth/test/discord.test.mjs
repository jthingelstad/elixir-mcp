import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../../../services/migrate/src/migrate.mjs";
import { emailHash } from "../src/index.mjs";
import {
  startDiscordLogin,
  takeDiscordLogin,
  discordAuthorizeUrl,
  readDiscordCookie,
  discordCookie,
  linkDiscord,
  unlinkDiscord,
  accountForDiscord,
  discordLinkOf,
  createDiscordLoginBridge,
  createDiscordLoginWorker,
  discordLoginRequestKey,
  discordLoginReplyKey,
  discordLoginClaimKey,
  DISCORD_REDIRECT_URI,
} from "../src/discord.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_discord_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

let db;
let ann;
let bob;
const ANN_DISCORD = "123456789012345678";

async function account(email) {
  const { rows } = await db.query(
    `insert into account (email_hash, email, status) values ($1, $2, 'approved')
     returning account_id`,
    [emailHash(email), email],
  );
  return rows[0].account_id;
}

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.query(`create database ${NAME}`);
  await admin.end();
  await migrate({
    databaseUrl: DB_URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  ann = await account("ann@example.com");
  bob = await account("bob@example.com");
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

test("a round trip is used once, and only by the browser that started it", async () => {
  const { state, nonce } = await startDiscordLogin(db, { intent: "signin" });
  const other = (await startDiscordLogin(db, { intent: "signin" })).nonce;
  assert.equal(await takeDiscordLogin(db, { state, nonce: other }), null);
  const row = await takeDiscordLogin(db, { state, nonce });
  assert.equal(row.intent, "signin");
  assert.equal(row.account_id, null);
  assert.equal(await takeDiscordLogin(db, { state, nonce }), null);
});

test("an expired round trip is refused", async () => {
  const { state, nonce } = await startDiscordLogin(db, { intent: "signin" });
  await db.query(
    `update discord_login set expires_at = now() - interval '1 second'`,
  );
  assert.equal(await takeDiscordLogin(db, { state, nonce }), null);
});

test("linking binds the account and session; a sign-in carries the signup choices", async () => {
  const link = await startDiscordLogin(db, {
    intent: "link",
    accountId: ann,
    sessionId: "s1",
    signupZone: "America/Chicago",
  });
  const row = await takeDiscordLogin(db, link);
  assert.equal(row.account_id, ann);
  assert.equal(row.session_id, "s1");
  assert.equal(row.signup_zone, null);
  const signin = await startDiscordLogin(db, {
    intent: "signin",
    accountId: ann,
    signupZone: "America/Chicago",
    signupNews: true,
  });
  const s = await takeDiscordLogin(db, signin);
  assert.equal(s.account_id, null);
  assert.equal(s.signup_zone, "America/Chicago");
  assert.equal(s.signup_news, true);
});

test("the cookie and the consent URL", () => {
  const cookie = discordCookie("abc", 600);
  assert.match(
    cookie,
    /^__Host-elixir_discord=abc; Path=\/; Secure; HttpOnly; SameSite=Lax/,
  );
  assert.equal(
    readDiscordCookie({
      headers: { cookie: "a=1; __Host-elixir_discord=xyz" },
    }),
    "xyz",
  );
  const link = new URL(
    discordAuthorizeUrl({ clientId: "42", state: "s", intent: "link" }),
  );
  assert.equal(link.searchParams.get("scope"), "identify");
  assert.equal(link.searchParams.get("redirect_uri"), DISCORD_REDIRECT_URI);
  const signin = new URL(
    discordAuthorizeUrl({ clientId: "42", state: "s", intent: "signin" }),
  );
  assert.equal(signin.searchParams.get("scope"), "identify email");
});

test("one Discord user per account and one account per Discord user", async () => {
  assert.deepEqual(
    await linkDiscord(db, ann, { id: ANN_DISCORD, username: "ann" }),
    { ok: true },
  );
  assert.equal((await accountForDiscord(db, ANN_DISCORD)).account_id, ann);
  assert.deepEqual(
    await linkDiscord(db, bob, { id: ANN_DISCORD, username: "ann" }),
    { ok: false, code: "discord_taken" },
  );
  // Ann relinks to a new Discord user: the old one is free again.
  assert.deepEqual(
    await linkDiscord(db, ann, { id: "223456789012345678", username: "ann2" }),
    { ok: true },
  );
  assert.equal((await discordLinkOf(db, ann)).username, "ann2");
  assert.equal(await accountForDiscord(db, ANN_DISCORD), null);
  assert.deepEqual(
    await linkDiscord(db, bob, { id: ANN_DISCORD, username: "bob" }),
    { ok: true },
  );
  assert.equal(await unlinkDiscord(db, ann), true);
  assert.equal(await discordLinkOf(db, ann), null);
  assert.deepEqual(await linkDiscord(db, ann, { id: "nope", username: "x" }), {
    ok: false,
    code: "bad_discord_user",
  });
});

// ------------------------------------------------- the bridge and worker

/** Seals by tagging: enough to prove the binding to id and kind. */
const box = {
  seal: (plain, aad) => ({ plain, aad }),
  open: (b, aad) => (b?.aad === aad ? b.plain : null),
};

function memoryStorage() {
  const objects = new Map();
  return {
    objects,
    async get(key) {
      return objects.has(key) ? objects.get(key) : null;
    },
    async put(key, body) {
      if (objects.has(key)) return false;
      objects.set(key, body);
      return true;
    },
  };
}

function discordFake({ tokenStatus = 200, user } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith("/oauth2/token"))
      return {
        ok: tokenStatus === 200,
        status: tokenStatus,
        json: async () => ({ access_token: "tok" }),
      };
    if (url.endsWith("/users/@me"))
      return { ok: true, status: 200, json: async () => user };
    if (url.endsWith("/oauth2/token/revoke"))
      return { ok: true, status: 200, json: async () => ({}) };
    throw new Error(`unexpected ${url}`);
  };
  return { calls, fetchImpl };
}

const quiet = { log() {}, error() {} };

test("a code goes to the relay and the user comes back; the token is revoked", async () => {
  const storage = memoryStorage();
  const bridge = createDiscordLoginBridge({
    box,
    storage,
    pause: async () => {},
  });
  const sent = await bridge.send({ code: "abcDEF123", intent: "signin" });
  assert.equal(sent.ok, true);
  const discord = discordFake({
    user: {
      id: ANN_DISCORD,
      username: "ann",
      email: "Ann@Example.com",
      verified: true,
    },
  });
  const work = createDiscordLoginWorker({
    box,
    storage,
    clientId: "42",
    clientSecret: "shh",
    fetchImpl: discord.fetchImpl,
    log: quiet,
  });
  await work(discordLoginRequestKey(sent.id));
  const reply = await bridge.wait(sent.id, 1000);
  assert.deepEqual(reply, {
    ok: true,
    user: {
      id: ANN_DISCORD,
      username: "ann",
      email: "ann@example.com",
      verified: true,
    },
  });
  const urls = discord.calls.map((c) => c.url);
  assert.ok(urls.some((u) => u.endsWith("/oauth2/token/revoke")));
  const tokenCall = discord.calls[0];
  assert.match(tokenCall.init.body, /grant_type=authorization_code/);
  assert.match(
    tokenCall.init.body,
    new RegExp(`redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}`),
  );
  assert.equal(
    tokenCall.init.headers.Authorization,
    `Basic ${Buffer.from("42:shh").toString("base64")}`,
  );
  // A second notification of the same object changes nothing.
  await work(discordLoginRequestKey(sent.id));
  assert.equal(discord.calls.length, 3);
});

test("linking never carries the email, even when Discord sends one", async () => {
  const storage = memoryStorage();
  const bridge = createDiscordLoginBridge({
    box,
    storage,
    pause: async () => {},
  });
  const sent = await bridge.send({ code: "abc", intent: "link" });
  const discord = discordFake({
    user: { id: ANN_DISCORD, username: "ann", email: "a@b.c", verified: true },
  });
  await createDiscordLoginWorker({
    box,
    storage,
    clientId: "42",
    clientSecret: "shh",
    fetchImpl: discord.fetchImpl,
    log: quiet,
  })(discordLoginRequestKey(sent.id));
  const reply = await bridge.wait(sent.id, 1000);
  assert.equal(reply.user.email, null);
  assert.equal(reply.user.verified, false);
});

test("Discord refusing the code is a reply, never a throw", async () => {
  const storage = memoryStorage();
  const bridge = createDiscordLoginBridge({
    box,
    storage,
    pause: async () => {},
  });
  const sent = await bridge.send({ code: "used", intent: "signin" });
  const discord = discordFake({ tokenStatus: 400 });
  await createDiscordLoginWorker({
    box,
    storage,
    clientId: "42",
    clientSecret: "shh",
    fetchImpl: discord.fetchImpl,
    log: quiet,
  })(discordLoginRequestKey(sent.id));
  assert.deepEqual(await bridge.wait(sent.id, 1000), {
    ok: false,
    code: "discord_refused",
  });
});

test("a claim still settling comes back; a stale one is answered", async () => {
  let clock = 1_000_000;
  const storage = memoryStorage();
  const bridge = createDiscordLoginBridge({
    box,
    storage,
    now: () => clock,
    pause: async () => {},
  });
  const sent = await bridge.send({ code: "abc", intent: "signin" });
  await storage.put(
    discordLoginClaimKey(sent.id),
    JSON.stringify({ at: clock }),
  );
  const work = createDiscordLoginWorker({
    box,
    storage,
    clientId: "42",
    clientSecret: "shh",
    fetchImpl: async () => {
      throw new Error("never called");
    },
    now: () => clock,
    log: quiet,
  });
  await assert.rejects(work(discordLoginRequestKey(sent.id)), /pending/);
  clock += 60_000;
  await work(discordLoginRequestKey(sent.id));
  assert.deepEqual(
    JSON.parse(
      JSON.parse(storage.objects.get(discordLoginReplyKey(sent.id))).box.plain,
    ),
    { ok: false, code: "discord_error" },
  );
});

test("an expired request is never traded, and no reply is slow", async () => {
  let clock = 1_000_000;
  const storage = memoryStorage();
  const bridge = createDiscordLoginBridge({
    box,
    storage,
    now: () => clock,
    pause: async (ms) => {
      clock += ms;
    },
  });
  const sent = await bridge.send({ code: "abc", intent: "signin" });
  assert.deepEqual(await bridge.wait(sent.id, 1000), {
    ok: false,
    code: "discord_slow",
  });
  clock += 3_600_000;
  await createDiscordLoginWorker({
    box,
    storage,
    clientId: "42",
    clientSecret: "shh",
    fetchImpl: async () => {
      throw new Error("never called");
    },
    now: () => clock,
    log: quiet,
  })(discordLoginRequestKey(sent.id));
  assert.deepEqual(await bridge.wait(sent.id, 1000), {
    ok: false,
    code: "expired",
  });
});
