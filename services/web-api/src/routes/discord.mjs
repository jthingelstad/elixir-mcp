import {
  authLog,
  emailRef,
  emailHash,
  checkRateLimit,
  viewerIp,
  accountZone,
  readSessionCookie,
} from "@elixir-mcp/auth";
import {
  startDiscordLogin,
  takeDiscordLogin,
  discordAuthorizeUrl,
  discordCookie,
  readDiscordCookie,
  accountForDiscord,
  linkDiscord,
  unlinkDiscord,
  DISCORD_LOGIN_TTL_SECONDS,
} from "@elixir-mcp/auth/discord";

import { json } from "../http.mjs";

/** How long the callback waits for the relay's reply: under the door's
 *  30 s, with room for the database work after it. */
const REPLY_WAIT_MS = 12_000;
const PROFILE = "/console/account/profile";
const SIGNIN = "/console/signin";

const redirect = (location, cookies = []) => ({
  statusCode: 303,
  headers: { location, "cache-control": "no-store" },
  cookies,
  body: "",
});
const withOutcome = (path, outcome) => `${path}?discord=${outcome}`;

/**
 * Discord as a way in (#531): link a Discord user to the signed-in
 * account, or sign in with one. Email stays the identity: a sign-in
 * reaches the account linked to that Discord user, or the account of the
 * address Discord has verified (opening it when new); a Discord user with
 * no verified address is sent to email sign-in, then may link.
 *
 * Both start at `GET /api/auth/discord/start` (a browser navigation, so a
 * plain link in the Console) and come back to the callback Discord is
 * registered with. Every outcome is a redirect to the page that asked,
 * with `?discord=<outcome>` for it to say what happened.
 */
export function discordRoutes({
  resolveAccount,
  mintSessionResponse,
  logEvent,
  discordLogin,
}) {
  return {
    "GET /api/auth/discord/start": async (db, event) => {
      const q = event.queryStringParameters ?? {};
      const intent = q.intent === "link" ? "link" : "signin";
      const back = intent === "link" ? PROFILE : SIGNIN;
      if (!discordLogin) return redirect(withOutcome(back, "unavailable"));
      const ip = viewerIp(event) ?? "unknown";
      if (!(await checkRateLimit(db, { bucket: `discord#${ip}`, max: 30 })))
        return redirect(withOutcome(back, "limited"));
      let account = null;
      if (intent === "link") {
        // A browser's own session only: a bearer token is not a person
        // at a screen, and an agent's console never links a Discord.
        account =
          readSessionCookie(event) && !event.scopedAccount
            ? await resolveAccount(db, event)
            : null;
        if (!account)
          return redirect(`${SIGNIN}?return_to=${encodeURIComponent(PROFILE)}`);
      }
      const { state, nonce } = await startDiscordLogin(db, {
        intent,
        accountId: account?.accountId ?? null,
        sessionId: account?.sessionId ?? null,
        signupZone:
          typeof q.tz === "string" ? (accountZone(q.tz) ?? null) : null,
        signupNews: q.news === "1",
      });
      authLog("discord_started", {
        intent,
        ...(account ? { email: emailRef(account.emailHash) } : {}),
      });
      return redirect(
        discordAuthorizeUrl({ clientId: discordLogin.clientId, state, intent }),
        [discordCookie(nonce, DISCORD_LOGIN_TTL_SECONDS)],
      );
    },

    "GET /api/auth/discord/callback": async (db, event) => {
      const q = event.queryStringParameters ?? {};
      const clear = [discordCookie("", 0)];
      const row = await takeDiscordLogin(db, {
        state: q.state,
        nonce: readDiscordCookie(event),
      });
      if (!row) {
        authLog("discord_refused", { reason: "state" });
        return redirect(withOutcome(SIGNIN, "expired"), clear);
      }
      const back = row.intent === "link" ? PROFILE : SIGNIN;
      const done = (outcome, cookies = clear) =>
        redirect(withOutcome(back, outcome), cookies);
      // The person said no on Discord's page, or Discord said no.
      if (q.error || typeof q.code !== "string" || !q.code)
        return done(q.error === "access_denied" ? "cancelled" : "failed");
      if (!discordLogin) return done("unavailable");

      // Linking: the session that asked is the one that finishes, still
      // signed in. Anything else is a callback carried somewhere else.
      let account = null;
      if (row.intent === "link") {
        account = readSessionCookie(event)
          ? await resolveAccount(db, event)
          : null;
        if (
          !account ||
          account.accountId !== row.account_id ||
          account.sessionId !== row.session_id
        ) {
          authLog("discord_refused", { reason: "session" });
          return done("expired");
        }
      }

      const sent = await discordLogin.bridge.send({
        code: q.code,
        intent: row.intent,
      });
      const reply = sent.ok
        ? await discordLogin.bridge.wait(sent.id, REPLY_WAIT_MS)
        : sent;
      if (!reply.ok) {
        authLog("discord_refused", { reason: reply.code });
        return done(reply.code === "discord_slow" ? "slow" : "failed");
      }
      const user = reply.user;

      if (row.intent === "link") {
        const linked = await linkDiscord(db, account.accountId, user);
        if (!linked.ok) {
          authLog("discord_refused", {
            reason: linked.code,
            email: emailRef(account.emailHash),
          });
          return done("taken");
        }
        await logEvent(db, account.accountId, "discord_linked");
        authLog("discord_linked", { email: emailRef(account.emailHash) });
        return done("linked");
      }

      // Signing in. A linked Discord user reaches its account.
      const known = await accountForDiscord(db, user.id);
      let hash = known?.email_hash ?? null;
      let verifiedEmail = null;
      if (!hash) {
        // Otherwise the address Discord has verified is the identity:
        // its account, opened when new. No verified address, no way in:
        // email sign-in first, then link from the Profile page.
        if (!user.email || !user.verified) {
          authLog("discord_refused", { reason: "no_verified_email" });
          return done("no_email");
        }
        hash = emailHash(user.email);
        // That account may already have a different Discord user; it
        // keeps it, and this one signs in by email.
        const { rows } = await db.query(
          `select d.discord_user_id from account a
             join account_discord d using (account_id)
            where a.email_hash = $1`,
          [hash],
        );
        if (rows[0] && rows[0].discord_user_id !== user.id) {
          authLog("discord_refused", {
            reason: "other_discord",
            email: emailRef(hash),
          });
          return done("other");
        }
        verifiedEmail = user.email;
      }
      const minted = await mintSessionResponse(db, hash, {
        event,
        verifiedEmail,
        verifiedNewsletter: row.signup_news === true,
        verifiedZone: row.signup_zone ?? null,
      });
      if (minted.statusCode !== 200) {
        const body = JSON.parse(minted.body);
        authLog("discord_refused", {
          reason: body.error ?? "mint",
          email: emailRef(hash),
        });
        return done(body.error === "not_approved" ? "not_approved" : "failed");
      }
      const opened = JSON.parse(minted.body);
      const { rows: who } = await db.query(
        `select account_id from account where email_hash = $1`,
        [hash],
      );
      if (!known) {
        const linked = await linkDiscord(db, who[0].account_id, user);
        if (linked.ok) await logEvent(db, who[0].account_id, "discord_linked");
      }
      authLog("discord_signed_in", {
        email: emailRef(hash),
        new_account: Boolean(opened.new_account),
      });
      return redirect(
        withOutcome(SIGNIN, opened.new_account ? "new" : "signed_in"),
        [minted.headers["set-cookie"], ...clear],
      );
    },

    "POST /api/me/discord/unlink": async (db, event) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthorized" });
      if (event.scopedAccount) return json(403, { error: "forbidden" });
      const removed = await unlinkDiscord(db, account.accountId);
      if (removed) {
        await logEvent(db, account.accountId, "discord_unlinked");
        authLog("discord_unlinked", { email: emailRef(account.emailHash) });
      }
      return json(200, { ok: true, removed });
    },
  };
}
