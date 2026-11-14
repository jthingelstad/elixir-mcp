/** Passports and Stamps, first slice (#1015): two reads on the signed-in
 *  member gate.
 *
 *  - `GET /api/me/passport`: the owner's own passport, the public
 *    projection plus the profile list's steps and exact progress. The
 *    only write is lazily making the caller's own passport row.
 *  - `GET /api/passports/<passport-id>`: another member's passport, the
 *    public projection only. Never writes, never makes a passport.
 *
 *  A person's only: an agent is refused, and no agent console reaches
 *  either (AGENT_SCOPED_ROUTES does not list them). Nothing here grants a
 *  Stamp: grants come from the hooks and reconciliation of later slices. */
import { checkRateLimit } from "@elixir-mcp/auth";
import { readOwnerPassport, readPublicPassport } from "@elixir-mcp/stamps";
import { json } from "../http.mjs";

/** Reads per hour per account, for each of the two routes. */
const PASSPORT_READS_PER_HOUR = 600;

const notEntitled = () =>
  json(403, {
    error: "not_entitled",
    message: "A passport is a person's own; an agent has none.",
  });

const rateLimited = () =>
  json(429, { error: "rate_limited" }, { "retry-after": "600" });

export function passportRoutes({ resolveAccount }) {
  const person = async (db, event, bucket) => {
    const account = await resolveAccount(db, event);
    if (!account) return { refused: json(401, { error: "unauthenticated" }) };
    if (account.kind !== "person") return { refused: notEntitled() };
    if (
      !(await checkRateLimit(db, {
        bucket: `${bucket}#${account.accountId}`,
        max: PASSPORT_READS_PER_HOUR,
      }))
    )
      return { refused: rateLimited() };
    return { account };
  };

  return {
    "GET /api/me/passport": async (db, event) => {
      const { account, refused } = await person(db, event, "passport");
      if (refused) return refused;
      const out = await readOwnerPassport(db, account.accountId, {
        now: new Date(),
      });
      if (!out) return notEntitled();
      return json(200, out);
    },

    "GET /api/passports/*": async (db, event) => {
      const { refused } = await person(db, event, "passport_view");
      if (refused) return refused;
      const out = await readPublicPassport(db, event.pathParam);
      if (!out) return json(404, { error: "not_found" });
      return json(200, out);
    },
  };
}
