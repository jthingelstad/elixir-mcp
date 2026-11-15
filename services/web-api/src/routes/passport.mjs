/** Passports and Stamps, first slice (#1015): two reads on the signed-in
 *  member gate.
 *
 *  - `GET /api/me/passport`: the owner's own passport, the public
 *    projection plus the profile list's steps and exact progress. The
 *    only write is lazily making the caller's own passport row.
 *  - `GET /api/passports/<passport-id>`: another member's passport, the
 *    public projection only. Never writes, never makes a passport.
 *
 *
 *  And two owner writes (earning, #1015), the contract header required:
 *
 *  - `POST /api/me/passport/reconcile`: one bounded, idempotent pass that
 *    repairs and grants what hooks cannot see (Played Together, Inner
 *    Circle, Mutual, All Set, Storyteller, any setup Stamp a hook
 *    missed). Answers the owner's passport plus `granted` and `more`.
 *  - `POST /api/me/passport/map` `{choice: "not_now"}`: the profile
 *    list's map step answered "Not now". It completes the step and never
 *    grants On the Map.
 *  - `POST /api/me/passport/dismiss`: Home's profile list put away, by
 *    an account that finished the older welcome list (0274). It
 *    completes nothing and grants nothing; any other account is 409.
 *
 *  A person's only: an agent is refused, and no agent console reaches
 *  any of them (AGENT_SCOPED_ROUTES does not list them). The GETs never
 *  grant a Stamp. */
import { checkRateLimit } from "@elixir-mcp/auth";
import { readOwnedPlaces } from "@elixir-mcp/auth/clan-context";
import {
  dismissProfileList,
  readOwnerPassport,
  readPublicPassport,
  reconcilePassport,
  settlePassport,
} from "@elixir-mcp/stamps";
import { json } from "../http.mjs";

/** Reads per hour per account, for each of the two routes. */
const PASSPORT_READS_PER_HOUR = 600;
/** Reconciliations per hour per account: Home and the passport call it
 *  on open, and a client follows `more` a few times. */
const RECONCILES_PER_HOUR = 120;
/** "Not now" answers per hour per account. */
const MAP_ANSWERS_PER_HOUR = 60;
/** Dismissals per hour per account: it is set once, so a few is plenty. */
const DISMISSALS_PER_HOUR = 20;

/** Whether any of the account's verified players has a place on the
 *  clan map now. A boolean only: no place, city or point leaves here. */
async function hasPlace(db, accountId) {
  const { rows } = await db.query(
    `select player_tag from claim
      where account_id = $1::uuid and status = 'verified'
        and (is_primary or relationship in ('primary', 'alt'))`,
    [accountId],
  );
  if (rows.length === 0) return false;
  // Only a place this account wrote (a tag that moved here keeps none).
  const places = await readOwnedPlaces(
    db,
    rows.map((r) => r.player_tag),
  );
  return places.length > 0;
}

const notEntitled = () =>
  json(403, {
    error: "not_entitled",
    message: "A passport is a person's own; an agent has none.",
  });

const rateLimited = () =>
  json(429, { error: "rate_limited" }, { "retry-after": "600" });

export function passportRoutes({ resolveAccount }) {
  const person = async (
    db,
    event,
    bucket,
    { max = PASSPORT_READS_PER_HOUR, write = false } = {},
  ) => {
    const account = await resolveAccount(db, event, {
      requireContractHeader: write,
    });
    if (!account) return { refused: json(401, { error: "unauthenticated" }) };
    if (account.kind !== "person") return { refused: notEntitled() };
    if (
      !(await checkRateLimit(db, {
        bucket: `${bucket}#${account.accountId}`,
        max,
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

    // The owner's reconciliation. Bounded per call (packages/stamps
    // earn.mjs RECONCILE); `more: true` says a further call has more to
    // read. Idempotent: a repeat, or a race with a hook, adds nothing.
    "POST /api/me/passport/reconcile": async (db, event) => {
      const { account, refused } = await person(db, event, "passport_rec", {
        max: RECONCILES_PER_HOUR,
        write: true,
      });
      if (refused) return refused;
      const now = new Date();
      const run = await reconcilePassport(db, account.accountId, {
        now,
        placeSaved: () => hasPlace(db, account.accountId),
      });
      if (!run) return notEntitled();
      const out = await readOwnerPassport(db, account.accountId, { now });
      return json(200, { ...out, granted: run.granted, more: run.more });
    },

    // The map step's "Not now": the step is done, On the Map is not.
    "POST /api/me/passport/map": async (db, event, body) => {
      const { account, refused } = await person(db, event, "passport_map", {
        max: MAP_ANSWERS_PER_HOUR,
        write: true,
      });
      if (refused) return refused;
      if (body?.choice !== "not_now")
        return json(400, {
          error: "bad_request",
          message: 'The only answer here is {"choice": "not_now"}.',
        });
      const now = new Date();
      const settled = await settlePassport(db, account.accountId, {
        now,
        latch: { map_choice: "not_now" },
      });
      if (settled.refused) return notEntitled();
      const out = await readOwnerPassport(db, account.accountId, { now });
      return json(200, { ...out, granted: settled.granted, more: false });
    },

    // The profile list put away: only for an account that finished the
    // older welcome list (docs/product/stamps.md). Hides it, nothing more.
    "POST /api/me/passport/dismiss": async (db, event) => {
      const { account, refused } = await person(db, event, "passport_dismiss", {
        max: DISMISSALS_PER_HOUR,
        write: true,
      });
      if (refused) return refused;
      const now = new Date();
      const out = await dismissProfileList(db, account.accountId, { now });
      if (out.refused === "not_person") return notEntitled();
      if (out.refused === "not_offered")
        return json(409, {
          error: "not_offered",
          message:
            "The profile list can be dismissed only by an account that finished the older welcome list.",
        });
      return json(200, await readOwnerPassport(db, account.accountId, { now }));
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
