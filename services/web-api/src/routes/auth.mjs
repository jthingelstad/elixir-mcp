import {
  authLog,
  emailRef,
  emailHash,
  requestAccess,
  approvedAccount,
  startMagicLogin,
  redeemMagicToken,
  verifyMagicCode,
  revokeSession,
  checkRateLimit,
  createMagicToken,
  sha256hex,
  offerHandoff,
  confirmHandoff,
  takeHandoff,
  sessionSeenFrom,
  listSessions,
  revokeAccountSessions,
} from "@elixir-mcp/auth";
import { normalizeTag } from "@elixir-mcp/contracts";

import { json, sessionCookie } from "../http.mjs";

/** The two rate-limit ceilings on sign-in mail, named once. */
const SIGNIN_MAIL_PER_IP_HOUR = 10;
const SIGNIN_MAIL_PER_ADDRESS_HOUR = 5;

export function authRoutes({
  resolveAccount,
  ping,
  mintSessionResponse,
  sendLoginEmail,
  notifyOwner,
}) {
  return {
    "POST /api/request-access": async (db, event, body) => {
      const ip = event.requestContext?.http?.sourceIp ?? "unknown";
      if (!(await checkRateLimit(db, { bucket: `reqaccess#${ip}`, max: 5 }))) {
        return json(429, { error: "rate_limited" });
      }
      const email = String(body.email ?? "").trim();
      if (!email.includes("@")) return json(400, { error: "bad_request" });
      let playerTag = null;
      try {
        playerTag = body.player_tag
          ? normalizeTag(String(body.player_tag))
          : null;
      } catch {
        return json(400, { error: "invalid_tag" });
      }
      const result = await requestAccess(db, {
        emailHash: emailHash(email),
        playerTag,
        note: String(body.note ?? "").slice(0, 500) || null,
        email: email.toLowerCase(),
      });
      if (result.created) {
        await notifyOwner({ kind: "access_request", playerTag });
        await ping("signup.requested");
      }
      // Identical response for new, repeat, denied, and already-approved.
      return json(200, {
        ok: true,
        message: "If your request is approved, you will hear from us by email.",
      });
    },

    "POST /api/auth": async (db, event, body) => {
      const ip = event.requestContext?.http?.sourceIp ?? "unknown";
      const email = String(body.email ?? "").trim();
      const okIp = await checkRateLimit(db, {
        bucket: `auth#${ip}`,
        max: SIGNIN_MAIL_PER_IP_HOUR,
      });
      const okEmail = await checkRateLimit(db, {
        bucket: `auth#${emailHash(email)}`,
        max: SIGNIN_MAIL_PER_ADDRESS_HOUR,
      });
      // The handoff secret (0083): minted for EVERY request, stored only
      // when a row is, so the answer's shape cannot say whether one was.
      const pollId = createMagicToken();
      if (!okIp || !okEmail) {
        // Said plainly. The counter runs for any address, approved or
        // not, so this is not an oracle; what it used to be was a person
        // sending a sixth email and waiting for mail that never came,
        // with the page insisting one was on its way.
        authLog("signin_mail_limited", {
          email: emailRef(emailHash(email)),
          by: okIp ? "address" : "ip",
        });
        return json(200, {
          ok: true,
          limited: true,
          poll_id: pollId,
          message:
            "That is the limit on sign-in emails for now. The most recent one still works for fifteen minutes; after an hour you can ask for another.",
        });
      }
      if (email.includes("@")) {
        const account = await approvedAccount(db, emailHash(email));
        if (account) {
          // Record the address on the way past. Accounts that predate us
          // keeping it fill in the first time their holder signs in,
          // rather than staying unreachable forever. The hash still
          // decided which account this is.
          await db.query(
            `update account set email = $2
             where account_id = $1 and email is distinct from $2`,
            [account.account_id, email.toLowerCase()],
          );
          authLog("signin_code_issued", { email: emailRef(emailHash(email)) });
          const { token, code } = await startMagicLogin(db, {
            emailHash: emailHash(email),
            purpose: "web",
            pollId,
            startedFrom: {
              ...sessionSeenFrom(event),
              at: new Date().toISOString(),
            },
          });
          await sendLoginEmail({
            email,
            code,
            token,
            purpose: "web",
            // Beta participation includes the product emails (0051).
            // Read here because the relay has no database; unsubscribing
            // happens at Buttondown and is never overridden.
            newsletter: account.newsletter_opt_in === true,
          });
        }
      }
      return json(200, {
        ok: true,
        poll_id: pollId,
        message: "If your account is approved, a sign-in email is on its way.",
      });
    },

    "POST /api/auth/redeem": async (db, event, body) => {
      const row = await redeemMagicToken(db, body.token);
      if (!row || row.purpose !== "web")
        return json(400, { error: "invalid_or_expired" });
      await ping("site.signin", "magic_link");
      // The screen that asked may be a different one (0083). From the
      // same address the session is handed over now; from a different
      // one this screen is asked first, and the answer rides back on
      // the confirm secret.
      let extra = {};
      if (row.poll_id_hash) {
        const here = sessionSeenFrom(event);
        const started = row.started_from ?? {};
        const same = Boolean(here.from) && here.from === started.from;
        const confirm = await offerHandoff(db, {
          tokenHash: row.token_hash,
          state: same ? "ready" : "confirm",
        });
        extra = same
          ? { handoff: { state: "done" } }
          : {
              handoff: {
                state: "confirm",
                confirm,
                started: {
                  at: started.at ?? null,
                  country: started.country ?? null,
                  client: started.client ?? null,
                },
              },
            };
      }
      return mintSessionResponse(db, row.email_hash, { event, extra });
    },

    // The redeeming screen said yes: the screen that asked may collect.
    // Signed in here already (the redeem minted it), and the secret is
    // bound to that account, so a confirm from anyone else is a no-op.
    "POST /api/auth/handoff": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthorized" });
      const ok = await confirmHandoff(db, {
        confirm: body.confirm,
        emailHash: account.emailHash,
      });
      return json(ok ? 200 : 400, ok ? { ok: true } : { error: "no_handoff" });
    },

    // The screen that asked, waiting. Answers { ready: false } until the
    // link has been opened and allowed; then mints THIS screen's session
    // and answers as a sign-in does. One collection per row.
    "POST /api/auth/poll": async (db, event, body) => {
      // Keyed on the viewer's own address (sourceIp is an edge node,
      // shared): a screen asking every four seconds for the link's
      // fifteen minutes is 225 asks, and the ceilings sit above that.
      const from =
        sessionSeenFrom(event).from ??
        event.requestContext?.http?.sourceIp ??
        "unknown";
      const okIp = await checkRateLimit(db, {
        bucket: `poll#${from}`,
        max: 900,
      });
      const okId = await checkRateLimit(db, {
        bucket: `poll#${sha256hex(String(body.poll_id ?? ""))}`,
        max: 300,
      });
      if (!okIp || !okId) return json(429, { error: "rate_limited" });
      const hash = await takeHandoff(db, body.poll_id);
      if (!hash) return json(200, { ready: false });
      await ping("site.signin", "handoff");
      return mintSessionResponse(db, hash, { event, extra: { ready: true } });
    },

    // The Profile page's device list (0083): every session that could
    // still act as this account, this one marked.
    "GET /api/me/sessions": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthorized" });
      const rows = await listSessions(db, account.accountId);
      return json(200, {
        sessions: rows.map((r) => ({
          id: r.session_id,
          current: r.session_id === account.sessionId,
          client: r.client,
          from: r.last_seen_from,
          country: r.last_seen_country,
          created_at: r.created_at,
          last_seen_at: r.last_seen_at,
          expires_at: r.sliding_expires_at,
        })),
      });
    },

    // One device, or everywhere else. Signing out THIS one is the sign-out
    // button; revoking it from here would answer a page it can no longer
    // render. Both are scoped to the account, so a foreign id does nothing.
    "POST /api/me/sessions/revoke": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthorized" });
      const everywhere = body.everywhere === true;
      const sessionId = everywhere ? null : String(body.session_id ?? "");
      if (!everywhere && (!sessionId || sessionId === account.sessionId))
        return json(400, { error: "bad_request" });
      const revoked = await revokeAccountSessions(db, account.accountId, {
        sessionId,
        except: account.sessionId,
      });
      authLog(everywhere ? "sessions_revoked_everywhere" : "session_revoked", {
        email: emailRef(account.emailHash),
        revoked,
      });
      return json(200, { ok: true, revoked });
    },

    "POST /api/auth/code": async (db, event, body) => {
      const hash = emailHash(String(body.email ?? ""));
      // Scoped to this flow: a pending OAuth authorization is not ours to
      // consume, and its attempts are not ours to spend.
      const result = await verifyMagicCode(db, {
        emailHash: hash,
        code: body.code,
        purpose: "web",
      });
      if (!result.ok) {
        authLog("signin_code_rejected", {
          email: emailRef(hash),
          reason: result.reason,
          attempts: result.attempts,
        });
        return json(400, {
          error: "invalid_or_expired",
          reason: result.reason,
        });
      }
      authLog("signin_code_accepted", { email: emailRef(hash) });
      await ping("site.signin", "code");
      return mintSessionResponse(db, hash, { event });
    },

    "POST /api/session/signout": async (db, event) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (account) await revokeSession(db, account.sessionId);
      return json(200, { ok: true }, { "set-cookie": sessionCookie("", 0) });
    },
  };
}
