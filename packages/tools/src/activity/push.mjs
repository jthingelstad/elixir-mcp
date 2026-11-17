/**
 * Web push's store (2026-11-16, migration 0283,
 * docs/notes/2026-11-16-web-push.md): a person's devices, their switches
 * per kind, and the notices told. Read by the web API (Settings ›
 * Notifications), the jobs Lambda (the push drain, the activity mail and
 * Clan's morning run) and the timeline sync (the relay's receipts).
 *
 * A subscription's endpoint and keys are private account machinery: only
 * the drain reads them, to hand them to the relay. The account's own
 * device list shows a label and dates, never the endpoint.
 */
import { PUSH_KINDS, isPushEndpoint, isPushKind } from "@elixir-mcp/contracts";

/** Devices one account may hold; the oldest goes past it. */
export const PUSH_DEVICE_CAP = 10;

/** A device's label from its browser's own words, plain and short. */
export function deviceLabel(raw) {
  return String(raw ?? "")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

/** A subscription as the browser gives it (PushSubscription.toJSON()),
 *  checked: null when it is not one Elixir can push to. */
export function checkSubscription(sub) {
  const endpoint = sub?.endpoint;
  const p256dh = sub?.keys?.p256dh;
  const auth = sub?.keys?.auth;
  if (!isPushEndpoint(endpoint)) return null;
  const b64u = /^[A-Za-z0-9_-]+$/;
  if (typeof p256dh !== "string" || !b64u.test(p256dh)) return null;
  if (typeof auth !== "string" || !b64u.test(auth)) return null;
  if (Buffer.from(p256dh, "base64url").length !== 65) return null;
  if (Buffer.from(auth, "base64url").length !== 16) return null;
  return { endpoint, p256dh, auth };
}

/**
 * Whether the browser's own subscription is this account's device, for
 * the page that asks (never an endpoint back). A device answers to
 * whoever is signed in on it: held by another account, it is dropped
 * there, so that account's notices stop on a browser now signed in as
 * someone else, and this account must turn it on itself. Holding the
 * endpoint is the proof: it is a capability only that browser has.
 */
export async function reconcileDevice(db, accountId, endpoint) {
  if (!isPushEndpoint(endpoint)) return { registered: false };
  const { rows } = await db.query(
    `select subscription_id, account_id from push_subscription
      where endpoint = $1`,
    [endpoint],
  );
  if (!rows[0]) return { registered: false };
  if (rows[0].account_id === accountId)
    return { registered: true, id: String(rows[0].subscription_id) };
  await db.query(`delete from push_subscription where subscription_id = $1`, [
    rows[0].subscription_id,
  ]);
  return { registered: false };
}

/** The account's devices, newest first: label and dates, never the
 *  endpoint. */
export async function listDevices(db, accountId) {
  const { rows } = await db.query(
    `select subscription_id, device_label, created_at, last_success_at
       from push_subscription where account_id = $1
      order by created_at desc, subscription_id desc`,
    [accountId],
  );
  return rows.map((r) => ({
    id: String(r.subscription_id),
    label: r.device_label || "A device",
    created_at: r.created_at,
    last_success_at: r.last_success_at,
  }));
}

/** Turning a device on: one row per endpoint. An endpoint another
 *  account held moves to this one (the same browser, signed in anew). The
 *  oldest of more than PUSH_DEVICE_CAP goes. Returns the device's id. */
export async function addDevice(db, accountId, sub, label) {
  const { rows } = await db.query(
    `insert into push_subscription (account_id, endpoint, p256dh, auth, device_label)
     values ($1, $2, $3, $4, $5)
     on conflict (endpoint) do update
       set account_id = excluded.account_id, p256dh = excluded.p256dh,
           auth = excluded.auth, device_label = excluded.device_label,
           created_at = case when push_subscription.account_id = excluded.account_id
                             then push_subscription.created_at else now() end
     returning subscription_id`,
    [accountId, sub.endpoint, sub.p256dh, sub.auth, deviceLabel(label)],
  );
  await db.query(
    `delete from push_subscription
      where account_id = $1 and subscription_id not in (
        select subscription_id from push_subscription where account_id = $1
         order by created_at desc, subscription_id desc limit $2)`,
    [accountId, PUSH_DEVICE_CAP],
  );
  return String(rows[0].subscription_id);
}

/** Removing one of the account's own devices; false when it is not one. */
export async function removeDevice(db, accountId, id) {
  if (!/^\d{1,18}$/.test(String(id ?? ""))) return false;
  const { rowCount } = await db.query(
    `delete from push_subscription where account_id = $1 and subscription_id = $2`,
    [accountId, id],
  );
  return rowCount > 0;
}

/** Removing this browser's own subscription by its endpoint (turning
 *  this device off), only within the account. */
export async function removeEndpoint(db, accountId, endpoint) {
  if (typeof endpoint !== "string") return false;
  const { rowCount } = await db.query(
    `delete from push_subscription where account_id = $1 and endpoint = $2`,
    [accountId, endpoint],
  );
  return rowCount > 0;
}

/** Each kind's switch: a stored row, else on. */
export async function pushKinds(db, accountId) {
  const { rows } = await db.query(
    `select kind, enabled from account_push_pref where account_id = $1`,
    [accountId],
  );
  const by = new Map(rows.map((r) => [r.kind, r.enabled]));
  return Object.fromEntries(PUSH_KINDS.map((k) => [k, by.get(k) ?? true]));
}

export async function setPushKind(db, accountId, kind, enabled) {
  if (!isPushKind(kind)) throw new Error("unknown push kind");
  await db.query(
    `insert into account_push_pref (account_id, kind, enabled) values ($1, $2, $3)
     on conflict (account_id, kind) do update
       set enabled = excluded.enabled, changed_at = now()`,
    [accountId, kind, enabled === true],
  );
}

/** A notice the person tapped: the activity mail does not tell it again.
 *  Only their own; false otherwise. */
export async function markOpened(db, accountId, noticeId) {
  if (!/^[0-9a-f-]{36}$/.test(String(noticeId ?? ""))) return false;
  const { rowCount } = await db.query(
    `update push_notice set opened_at = coalesce(opened_at, now())
      where notice_id = $2 and account_id = $1`,
    [accountId, noticeId],
  );
  return rowCount > 0;
}

/** For the activity mail: through when an opened notice told each of
 *  cheers and followers, or null. */
export async function pushToldAt(db, accountId) {
  const { rows } = await db.query(
    `select kind, max(through) as through from push_notice
      where account_id = $1 and opened_at is not null
        and kind in ('cheers', 'followers')
      group by kind`,
    [accountId],
  );
  const by = new Map(rows.map((r) => [r.kind, r.through]));
  return {
    cheers: by.get("cheers") ?? null,
    followers: by.get("followers") ?? null,
  };
}

/**
 * A notice owed to an account by a run that is not the drain (Clan's
 * morning run: an Action that became yours). Owed only when the account
 * has a device and the kind on; `dedupeKey` makes a rerun one notice.
 * The drain sends it on its next minute.
 */
export async function owePush(
  db,
  { accountId, kind, title, body = "", url, dedupeKey },
) {
  if (!isPushKind(kind)) throw new Error("unknown push kind");
  const { rowCount } = await db.query(
    `insert into push_notice (account_id, kind, title, body, url, through, dedupe_key)
     select $1, $2, $3, $4, $5, now(), $6
      where exists (select 1 from push_subscription s where s.account_id = $1)
        and coalesce((select p.enabled from account_push_pref p
                       where p.account_id = $1 and p.kind = $2), true)
     on conflict (dedupe_key) do nothing`,
    [accountId, kind, title.slice(0, 120), body.slice(0, 200), url, dedupeKey],
  );
  return rowCount > 0;
}

/** The relay's receipt for one device (push-receipt/): a success stamps
 *  the device, a gone (404, 410) deletes it. Null for a receipt that is
 *  not one. */
export async function applyPushReceipt(db, msg) {
  if (msg?.v !== 1 || !/^\d{1,18}$/.test(String(msg.subscription_id ?? "")))
    return null;
  if (msg.outcome === "sent") {
    const { rowCount } = await db.query(
      `update push_subscription set last_success_at = now()
        where subscription_id = $1`,
      [msg.subscription_id],
    );
    return { outcome: "sent", updated: rowCount };
  }
  if (msg.outcome === "gone") {
    const { rowCount } = await db.query(
      `delete from push_subscription where subscription_id = $1`,
      [msg.subscription_id],
    );
    return { outcome: "gone", deleted: rowCount };
  }
  if (msg.outcome === "failed") return { outcome: "failed" };
  return null;
}
