import {
  emailHash,
  requestAccess,
  approvedAccount,
  startMagicLogin,
  redeemMagicToken,
  verifyMagicCode,
  revokeSession,
  checkRateLimit,
} from "@elixir-mcp/auth";
import { normalizeTag } from "@elixir-mcp/contracts";

import { json, sessionCookie } from "../http.mjs";

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
      const okIp = await checkRateLimit(db, { bucket: `auth#${ip}`, max: 10 });
      const okEmail = await checkRateLimit(db, {
        bucket: `auth#${emailHash(email)}`,
        max: 5,
      });
      if (okIp && okEmail && email.includes("@")) {
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
          const { token, code } = await startMagicLogin(db, {
            emailHash: emailHash(email),
            purpose: "web",
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
        message: "If your account is approved, a sign-in email is on its way.",
      });
    },

    "POST /api/auth/redeem": async (db, _event, body) => {
      const row = await redeemMagicToken(db, body.token);
      if (!row || row.purpose !== "web")
        return json(400, { error: "invalid_or_expired" });
      await ping("site.signin", "magic_link");
      return mintSessionResponse(db, row.email_hash);
    },

    "POST /api/auth/code": async (db, _event, body) => {
      const hash = emailHash(String(body.email ?? ""));
      const row = await verifyMagicCode(db, {
        emailHash: hash,
        code: body.code,
      });
      if (!row || row.purpose !== "web")
        return json(400, { error: "invalid_or_expired" });
      await ping("site.signin", "code");
      return mintSessionResponse(db, hash);
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
