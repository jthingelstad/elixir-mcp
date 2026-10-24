/**
 * Discord as a way in (#531; Jamie, 2026-10-24). Email stays the identity:
 * Discord's own OAuth proves which Discord user a person is, and that
 * proof is linked to one email-identified account (account_discord, 0233)
 * or signs in to it. Never a second identity.
 *
 * Three halves, each its own export:
 *
 * - The round trip's state (discord_login): a random `state` for Discord
 *   and a `nonce` for the browser's cookie, both stored only as hashes,
 *   used once, ten minutes. Linking also binds the session that asked, so
 *   a callback carried into another browser or session does nothing (the
 *   login-CSRF that would link an attacker's Discord to someone else).
 * - The bridge: the web API has no internet, so the code Discord hands
 *   back goes to the relay through the outbox as the clan's Discord posts
 *   do (`clan/discord-bridge.mjs`): a sealed request, claimed once before
 *   Discord is called, and a sealed reply the door waits for.
 * - The worker, in the relay: trades the code for a token, reads the user
 *   once, revokes the token, and replies with the user. No Discord token
 *   is kept anywhere.
 *
 * The box (AES-256-GCM, `clan/sealed.mjs`) and the object storage are
 * handed in by the services that hold the secret, as the timeline's
 * webhook seal is.
 */

import crypto from "node:crypto";
import { sha256hex } from "./crypto.mjs";

export const DISCORD_LOGIN_PURPOSE = "discord login v1";
export const DISCORD_LOGIN_TTL_SECONDS = 600;
/** Where Discord sends the browser back: registered on the Discord
 *  application, and the same in the request and the token exchange. */
export const DISCORD_REDIRECT_URI =
  "https://elixir.poapkings.com/api/auth/discord/callback";
export const DISCORD_COOKIE_NAME = "__Host-elixir_discord";
/** Linking needs only who they are; signing in also needs the address,
 *  because email is the identity. */
export const DISCORD_SCOPES = { link: "identify", signin: "identify email" };

const SNOWFLAKE = /^[0-9]{17,20}$/;
const STATE_RE = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

export const validDiscordUserId = (id) => SNOWFLAKE.test(String(id ?? ""));

// ------------------------------------------------------------- the state

/** Start one round trip: `{ state, nonce }` in plaintext, for Discord and
 *  the cookie; only their hashes are stored. */
export async function startDiscordLogin(
  db,
  {
    intent,
    accountId = null,
    sessionId = null,
    signupZone = null,
    signupNews = false,
  },
) {
  if (!["link", "signin"].includes(intent))
    throw new Error("discord login intent is link or signin");
  const state = crypto.randomBytes(32).toString("base64url");
  const nonce = crypto.randomBytes(32).toString("base64url");
  await db.query(
    `insert into discord_login (state_hash, nonce_hash, intent, account_id, session_id,
                                signup_zone, signup_news, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(secs => $8))`,
    [
      sha256hex(state),
      sha256hex(nonce),
      intent,
      intent === "link" ? accountId : null,
      intent === "link" ? sessionId : null,
      intent === "signin" ? signupZone : null,
      intent === "signin" && signupNews === true,
      DISCORD_LOGIN_TTL_SECONDS,
    ],
  );
  return { state, nonce };
}

/** Use a round trip once: the row when the state is live, unused and was
 *  started by the browser holding `nonce`; otherwise null. */
export async function takeDiscordLogin(db, { state, nonce }) {
  if (
    !STATE_RE.test(String(state ?? "")) ||
    !STATE_RE.test(String(nonce ?? ""))
  )
    return null;
  const { rows } = await db.query(
    `update discord_login set used_at = now()
      where state_hash = $1 and nonce_hash = $2
        and used_at is null and expires_at > now()
      returning intent, account_id, session_id, signup_zone, signup_news`,
    [sha256hex(state), sha256hex(nonce)],
  );
  return rows[0] ?? null;
}

/** The browser's half of the binding: SameSite=Lax, so Discord's
 *  top-level redirect back carries it. */
export function discordCookie(nonce, maxAgeSeconds) {
  return `${DISCORD_COOKIE_NAME}=${nonce}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function readDiscordCookie(event) {
  for (const c of String(event.headers?.cookie ?? "").split(/;\s*/)) {
    if (c.startsWith(`${DISCORD_COOKIE_NAME}=`))
      return c.slice(DISCORD_COOKIE_NAME.length + 1);
  }
  return "";
}

/** Discord's consent page for this round trip. `prompt=none` skips the
 *  screen for someone who has already allowed Elixir these scopes. */
export function discordAuthorizeUrl({ clientId, state, intent }) {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: DISCORD_SCOPES[intent],
    redirect_uri: DISCORD_REDIRECT_URI,
    state,
    prompt: "none",
  });
  return `https://discord.com/oauth2/authorize?${q}`;
}

// -------------------------------------------------------------- the link

/** The person account a Discord user is linked to, or null. */
export async function accountForDiscord(db, discordUserId) {
  if (!validDiscordUserId(discordUserId)) return null;
  const { rows } = await db.query(
    `select a.account_id, a.email_hash, a.status
       from account_discord d join account a using (account_id)
      where d.discord_user_id = $1 and a.kind = 'person'`,
    [discordUserId],
  );
  return rows[0] ?? null;
}

export async function discordLinkOf(db, accountId) {
  const { rows } = await db.query(
    `select discord_user_id, username, linked_at from account_discord
      where account_id = $1`,
    [accountId],
  );
  return rows[0] ?? null;
}

/**
 * Link a proven Discord user to an account. A Discord user already linked
 * to ANOTHER account is refused (`discord_taken`): one account per
 * Discord user, and the other account unlinks it first. An account that
 * had a different Discord user now has this one (the person chose it,
 * signed in).
 */
export async function linkDiscord(db, accountId, { id, username }) {
  if (!validDiscordUserId(id)) return { ok: false, code: "bad_discord_user" };
  const name = String(username ?? "").slice(0, 64) || id;
  const { rows } = await db
    .query(
      `insert into account_discord (account_id, discord_user_id, username)
     values ($1, $2, $3)
     on conflict (account_id) do update
       set discord_user_id = excluded.discord_user_id,
           username = excluded.username,
           linked_at = case when account_discord.discord_user_id = excluded.discord_user_id
                            then account_discord.linked_at else now() end
     where not exists (select 1 from account_discord o
                        where o.discord_user_id = excluded.discord_user_id
                          and o.account_id <> excluded.account_id)
     returning account_id`,
      [accountId, id, name],
    )
    .catch((err) => {
      // The insert half of the race: another account took this Discord user.
      if (err?.code === "23505") return { rows: [] };
      throw err;
    });
  return rows[0] ? { ok: true } : { ok: false, code: "discord_taken" };
}

export async function unlinkDiscord(db, accountId) {
  const { rowCount } = await db.query(
    `delete from account_discord where account_id = $1`,
    [accountId],
  );
  return rowCount > 0;
}

// ------------------------------------------------------------ the bridge

const PREFIX = "discord-login/";
const MAX_BYTES = 8192;
/** A code Discord has not had traded within this is never traded. */
export const DISCORD_LOGIN_REQUEST_LIFETIME_MS = 600_000;
/** A claim this old with no reply was a worker that stopped mid-call. */
const CLAIM_SETTLE_MS = 30_000;

export const discordLoginRequestKey = (id) => `${PREFIX}request/${id}.json`;
export const discordLoginReplyKey = (id) => `${PREFIX}reply/${id}.json`;
export const discordLoginClaimKey = (id) => `${PREFIX}claim/${id}.json`;
export function discordLoginRequestId(key) {
  const m = /^discord-login\/request\/([^/]+)\.json$/.exec(String(key ?? ""));
  return m && UUID.test(m[1]) ? m[1] : null;
}

const encode = (box, id, kind, value) =>
  JSON.stringify({
    v: 1,
    id,
    box: box.seal(JSON.stringify(value), `discord-login:${kind}:${id}`),
  });
function decode(box, text, id, kind) {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_BYTES)
    throw new Error("invalid discord login payload");
  const envelope = JSON.parse(text);
  if (envelope.v !== 1 || envelope.id !== id || !UUID.test(id))
    throw new Error("invalid discord login envelope");
  const plain = box.open(envelope.box, `discord-login:${kind}:${id}`);
  if (!plain) throw new Error("discord login authentication failed");
  return JSON.parse(plain);
}

const validRequest = (r) =>
  !!r &&
  typeof r.code === "string" &&
  /^[A-Za-z0-9_-]{1,200}$/.test(r.code) &&
  ["link", "signin"].includes(r.intent) &&
  Number.isFinite(r.expires_at);

/** The door's half: hand a code to the relay, wait for who it was. */
export function createDiscordLoginBridge({
  box,
  storage,
  now = Date.now,
  pause = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  return {
    /** `{ ok: true, id }` once the request is in the outbox. */
    async send({ code, intent }) {
      const id = crypto.randomUUID();
      const request = {
        code,
        intent,
        expires_at: now() + DISCORD_LOGIN_REQUEST_LIFETIME_MS,
      };
      if (!validRequest(request))
        return { ok: false, code: "invalid_discord_code" };
      try {
        if (
          !(await storage.put(
            discordLoginRequestKey(id),
            encode(box, id, "request", request),
          ))
        )
          return { ok: false, code: "outbox_refused" };
      } catch {
        return { ok: false, code: "outbox_unavailable" };
      }
      return { ok: true, id };
    },
    /** The relay's answer within `timeoutMs`, or `{ ok: false, code:
     *  "discord_slow" }` when none came. */
    async wait(id, timeoutMs) {
      const end = now() + timeoutMs;
      try {
        while (now() < end) {
          const text = await storage.get(discordLoginReplyKey(id));
          if (text !== null) return decode(box, text, id, "reply");
          await pause(Math.min(250, Math.max(1, end - now())));
        }
      } catch {
        return { ok: false, code: "discord_error" };
      }
      return { ok: false, code: "discord_slow" };
    },
  };
}

// ------------------------------------------------------------ the worker

const DISCORD_API = "https://discord.com/api/v10";

/** Discord's user, trimmed to what Elixir uses. The email only when the
 *  sign-in scope asked for it, and only with Discord's word on whether it
 *  is verified. */
function userOf(body, intent) {
  if (!validDiscordUserId(body?.id)) return null;
  const email =
    intent === "signin" && typeof body.email === "string" && body.email
      ? body.email.trim().toLowerCase().slice(0, 254)
      : null;
  return {
    id: body.id,
    username: String(body.username ?? "").slice(0, 64) || body.id,
    email,
    verified: email ? body.verified === true : false,
  };
}

/**
 * The relay's half. `work(key)` answers one request object: claim it once,
 * trade the code, read the user, revoke the token, reply. Discord's
 * refusals are replies, never throws, so a sign-in never dead-letters the
 * mail queue it shares; only a claim still settling throws, to come back.
 */
export function createDiscordLoginWorker({
  box,
  storage,
  clientId,
  clientSecret,
  fetchImpl = fetch,
  now = Date.now,
  log = console,
}) {
  const basic = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  const form = (fields) => ({
    method: "POST",
    headers: {
      Authorization: basic,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Elixir (https://elixir.poapkings.com, 1)",
    },
    body: new URLSearchParams(fields).toString(),
    signal: AbortSignal.timeout(5_000),
  });

  async function exchange(request) {
    let token;
    try {
      const res = await fetchImpl(
        `${DISCORD_API}/oauth2/token`,
        form({
          grant_type: "authorization_code",
          code: request.code,
          redirect_uri: DISCORD_REDIRECT_URI,
        }),
      );
      if (!res.ok)
        return {
          ok: false,
          code: res.status >= 500 ? "discord_error" : "discord_refused",
        };
      token = (await res.json())?.access_token;
    } catch {
      return { ok: false, code: "discord_error" };
    }
    if (typeof token !== "string" || !token)
      return { ok: false, code: "discord_error" };
    let user = null;
    try {
      const res = await fetchImpl(`${DISCORD_API}/users/@me`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "Elixir (https://elixir.poapkings.com, 1)",
        },
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) user = userOf(await res.json(), request.intent);
    } catch {
      user = null;
    }
    // The token has done its one job; nothing keeps it. A failed revoke
    // leaves a token that expires on its own, held by nobody.
    try {
      await fetchImpl(
        `${DISCORD_API}/oauth2/token/revoke`,
        form({ token, token_type_hint: "access_token" }),
      );
    } catch {
      log.error?.("discord_login", "revoke_failed");
    }
    return user ? { ok: true, user } : { ok: false, code: "discord_error" };
  }

  return async function work(key) {
    const id = discordLoginRequestId(key);
    if (!id) throw new Error("unsupported discord login object");
    if ((await storage.get(discordLoginReplyKey(id))) !== null) return;
    const text = await storage.get(key);
    if (text === null) return;
    let request;
    try {
      request = decode(box, text, id, "request");
    } catch {
      request = null;
    }
    const reply = (value) =>
      storage.put(discordLoginReplyKey(id), encode(box, id, "reply", value));
    if (
      !validRequest(request) ||
      request.expires_at > now() + DISCORD_LOGIN_REQUEST_LIFETIME_MS
    ) {
      log.log("discord_login", "invalid_request");
      return;
    }
    if (request.expires_at <= now()) {
      await reply({ ok: false, code: "expired" });
      return;
    }
    if (
      !(await storage.put(
        discordLoginClaimKey(id),
        JSON.stringify({ at: now() }),
      ))
    ) {
      // Another copy of the notification is trading this code. Its reply
      // will come; one that never does says so once the claim settles.
      let at = Infinity;
      try {
        at = JSON.parse(
          (await storage.get(discordLoginClaimKey(id))) ?? "{}",
        ).at;
      } catch {
        at = Infinity;
      }
      if (Number.isFinite(at) && now() - at < CLAIM_SETTLE_MS)
        throw new Error("discord login reply pending");
      await reply({ ok: false, code: "discord_error" });
      return;
    }
    const answer = await exchange(request);
    log.log("discord_login", answer.ok ? "ok" : answer.code);
    await reply(answer);
  };
}
