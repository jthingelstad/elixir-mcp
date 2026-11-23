/** Web push, Settings › Notifications (2026-11-16, migration 0283,
 *  docs/notes/2026-11-16-web-push.md).
 *
 *  Writes need the contract header, so a cross-site form cannot make
 *  one.
 *
 *  GET    /api/me/push                  whether push is offered, the
 *         VAPID public key, the account's devices (label and dates, never
 *         an endpoint) and each kind's switch
 *  POST   /api/me/push/subscriptions    {subscription, label}: this
 *         device on; its endpoint must be a known push service
 *  DELETE /api/me/push/subscriptions/*  one of the account's devices off
 *  POST   /api/me/push/off              {endpoint}: this device off, by
 *         the endpoint its browser holds
 *  POST   /api/me/push/this-device      {endpoint}: whether the
 *         browser's subscription is this account's device ({registered},
 *         never an endpoint); one another account held is dropped there
 *  PUT    /api/me/push/kinds            {kind, enabled}
 *  POST   /api/me/push/opened           {notice_id}: the service worker's
 *         tap, so the activity mail does not tell it again
 */
import { PUSH_KINDS, isPushKind } from "@elixir-mcp/contracts";
import { checkRateLimit } from "@elixir-mcp/auth";
import {
  addDevice,
  checkSubscription,
  listDevices,
  markOpened,
  pushKinds,
  reconcileDevice,
  removeDevice,
  removeEndpoint,
  setPushKind,
} from "@elixir-mcp/tools/activity/push";
import { json } from "../http.mjs";

/** Device changes an account may make in an hour. */
const PUSH_WRITES_PER_HOUR = 30;

const unauthenticated = () => json(401, { error: "unauthenticated" });
const off = () =>
  json(404, { error: "not_offered", message: "Notifications are off." });
const limited = () =>
  json(
    429,
    { error: "rate_limited", message: "Too many in an hour. Try again later." },
    { "retry-after": "600" },
  );

export function pushRoutes({ resolveAccount, publicKey = null }) {
  const offered = () => typeof publicKey === "string" && publicKey.length > 0;
  const person = async (db, event, write) => {
    const account = await resolveAccount(db, event, {
      requireContractHeader: write,
    });
    if (!account) return { refused: unauthenticated() };
    return { account };
  };
  const writable = async (db, event) => {
    const p = await person(db, event, true);
    if (p.refused) return p;
    if (
      !(await checkRateLimit(db, {
        bucket: `push#${p.account.accountId}`,
        max: PUSH_WRITES_PER_HOUR,
      }))
    )
      return { refused: limited() };
    return p;
  };

  return {
    "GET /api/me/push": async (db, event) => {
      const { account, refused } = await person(db, event, false);
      if (refused) return refused;
      return json(200, {
        offered: offered(),
        public_key: offered() ? publicKey : null,
        devices: await listDevices(db, account.accountId),
        kinds: await pushKinds(db, account.accountId),
      });
    },
    "POST /api/me/push/subscriptions": async (db, event, body) => {
      // Sign-in first: no route answers anything else to a stranger.
      const { account, refused } = await writable(db, event);
      if (refused) return refused;
      if (!offered()) return off();
      const sub = checkSubscription(body?.subscription);
      if (!sub)
        return json(400, {
          error: "invalid_subscription",
          message: "That is not a push subscription Elixir can use.",
        });
      const id = await addDevice(db, account.accountId, sub, body?.label);
      return json(200, {
        id,
        devices: await listDevices(db, account.accountId),
      });
    },
    "DELETE /api/me/push/subscriptions/*": async (db, event) => {
      const { account, refused } = await writable(db, event);
      if (refused) return refused;
      if (!(await removeDevice(db, account.accountId, event.pathParam)))
        return json(404, { error: "not_found" });
      return json(200, { devices: await listDevices(db, account.accountId) });
    },
    "POST /api/me/push/off": async (db, event, body) => {
      const { account, refused } = await writable(db, event);
      if (refused) return refused;
      await removeEndpoint(db, account.accountId, body?.endpoint);
      return json(200, { devices: await listDevices(db, account.accountId) });
    },
    "POST /api/me/push/this-device": async (db, event, body) => {
      const { account, refused } = await person(db, event, true);
      if (refused) return refused;
      if (!offered()) return json(200, { registered: false });
      const { registered, id } = await reconcileDevice(
        db,
        account.accountId,
        body?.endpoint,
      );
      return json(200, registered ? { registered, id } : { registered });
    },
    "PUT /api/me/push/kinds": async (db, event, body) => {
      const { account, refused } = await writable(db, event);
      if (refused) return refused;
      const kind = String(body?.kind ?? "");
      if (!isPushKind(kind) || typeof body?.enabled !== "boolean")
        return json(400, {
          error: "invalid_kind",
          message: `kind is one of ${PUSH_KINDS.join(", ")}; enabled is true or false.`,
        });
      await setPushKind(db, account.accountId, kind, body.enabled);
      return json(200, { kinds: await pushKinds(db, account.accountId) });
    },
    "POST /api/me/push/opened": async (db, event, body) => {
      const { account, refused } = await person(db, event, true);
      if (refused) return refused;
      const ok = await markOpened(db, account.accountId, body?.notice_id);
      return json(
        ok ? 200 : 404,
        ok ? { opened: true } : { error: "not_found" },
      );
    },
  };
}
