/** Delete your own account, Settings › Profile (2026-11-23).
 *
 *  POST /api/me/account/delete   {confirm: "DELETE"}
 *
 *  The session, the contract header and the typed confirmation are the
 *  whole guard. The removal is the one ops and Admin run
 *  (account-removal.mjs); on success the session cookie is cleared, as
 *  signing out clears it, since the session it named is gone. */
import { json, sessionCookie } from "../http.mjs";
import { REFUSAL_MESSAGES, runRemoval } from "../account-removal.mjs";

export function accountRemoveRoutes({
  resolveAccount,
  removeFromNewsletter = null,
  archive = null,
}) {
  return {
    "POST /api/me/account/delete": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthenticated" });
      if (body?.confirm !== "DELETE")
        return json(400, {
          error: "confirm_required",
          message: "Type DELETE to confirm.",
        });
      const result = await runRemoval(db, {
        accountId: account.accountId,
        dryRun: false,
        via: "self",
        removeFromNewsletter,
        archive,
      });
      if (result.error === "unavailable")
        return json(
          503,
          {
            error: "unavailable",
            message: "Nothing was deleted. Try again in a minute.",
          },
          { "retry-after": "60" },
        );
      if (result.error) return json(404, { error: "not_found" });
      if (result.refused) {
        const message =
          result.refused === "owns_integration"
            ? "Your account runs an integration. Write to admin@poapkings.com to delete it."
            : result.refused === "collectors_live"
              ? "Revoke your collector first, in Settings › Collectors. Then come back here."
              : (REFUSAL_MESSAGES[result.refused] ??
                "This account can't be deleted here.");
        return json(409, { error: "refused", code: result.refused, message });
      }
      return json(200, { ok: true }, { "set-cookie": sessionCookie("", 0) });
    },
  };
}
