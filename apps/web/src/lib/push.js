/**
 * Web push in the browser (2026-11-16, docs/notes/2026-11-16-web-push.md):
 * whether this device can have notifications, and turning them on and
 * off. Permission is asked only inside a tap (`turnOn`), never on load.
 *
 * iPhone and iPad allow web push only to a web app added to the Home
 * Screen (iOS 16.4 and later); in Safari itself the answer is "install".
 */

/** This device's case: "on-ready" (can ask), "denied" (the browser said
 *  no), "install" (iOS, not from the Home Screen), "unsupported". */
export function pushSupport(env = globalThis) {
  const nav = env.navigator;
  if (!nav) return "unsupported";
  const ua = String(nav.userAgent ?? "");
  const ios =
    /iPad|iPhone|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1);
  const standalone =
    nav.standalone === true ||
    Boolean(env.matchMedia?.("(display-mode: standalone)")?.matches);
  if (ios && !standalone) return "install";
  if (
    !("serviceWorker" in nav) ||
    typeof env.PushManager === "undefined" ||
    typeof env.Notification === "undefined"
  )
    return "unsupported";
  if (env.Notification.permission === "denied") return "denied";
  return "on-ready";
}

/** A short name for this device, from its browser: "Safari on iPhone". */
export function thisDeviceLabel(ua = globalThis.navigator?.userAgent ?? "") {
  const s = String(ua);
  const browser = /Edg\//.test(s)
    ? "Edge"
    : /Firefox\//.test(s)
      ? "Firefox"
      : /Chrome\//.test(s)
        ? "Chrome"
        : /Safari\//.test(s)
          ? "Safari"
          : "A browser";
  const os = /iPhone/.test(s)
    ? "iPhone"
    : /iPad/.test(s)
      ? "iPad"
      : /Android/.test(s)
        ? "Android"
        : /Mac OS X|Macintosh/.test(s)
          ? "Mac"
          : /Windows/.test(s)
            ? "Windows"
            : /Linux/.test(s)
              ? "Linux"
              : null;
  return os ? `${browser} on ${os}` : browser;
}

/** The VAPID public key (base64url) as the bytes subscribe() takes. */
export function keyBytes(base64url) {
  const b64 = String(base64url).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration(nav) {
  return (
    (await nav.serviceWorker.getRegistration("/")) ??
    (await nav.serviceWorker.register("/sw.js", { scope: "/" }))
  );
}

/** This browser's subscription, or null; never registers anything. */
export async function currentSubscription(env = globalThis) {
  const nav = env.navigator;
  if (!nav?.serviceWorker) return null;
  try {
    const reg = await nav.serviceWorker.getRegistration("/");
    return reg ? await reg.pushManager.getSubscription() : null;
  } catch {
    return null;
  }
}

/**
 * Whether this browser is on for the account signed in now
 * (2026-11-16, Codex on #1077): the browser's subscription alone is not
 * the answer, since it outlives Remove in Your devices and a change of
 * account. `check(endpoint)` posts the endpoint and gets a yes or no
 * back (the server never hands an endpoint out); a device another
 * account held is dropped there. Returns { subscribed, registered }.
 */
export async function thisDeviceState(check, env = globalThis) {
  const sub = await currentSubscription(env);
  if (!sub) return { subscribed: false, registered: false };
  try {
    const r = await check(sub.endpoint);
    return { subscribed: true, registered: r?.data?.registered === true };
  } catch {
    return { subscribed: true, registered: false };
  }
}

/**
 * Turning this device on, from a tap: asks permission, registers the
 * worker, subscribes with Elixir's key and hands the subscription to
 * `save(subscription, label)`. Returns "on", "denied" or "failed".
 */
export async function turnOn(publicKey, save, env = globalThis) {
  const permission = await env.Notification.requestPermission();
  if (permission !== "granted") return "denied";
  try {
    const nav = env.navigator;
    await registration(nav);
    const reg = await nav.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(publicKey),
      }));
    const res = await save(sub.toJSON(), thisDeviceLabel(nav.userAgent));
    return res?.ok === false ? "failed" : "on";
  } catch {
    return "failed";
  }
}

/** Turning this device off: the browser's subscription goes, and Elixir
 *  forgets it through `forget(endpoint)`. */
export async function turnOff(forget, env = globalThis) {
  const sub = await currentSubscription(env);
  if (!sub) return;
  const { endpoint } = sub;
  try {
    await sub.unsubscribe();
  } finally {
    await forget(endpoint);
  }
}

/** Signing out of this browser takes its notifications with it: the
 *  account's device row goes (while the session can still say so) and
 *  the browser's subscription is dropped. Best effort; never blocks the
 *  sign-out. */
export async function forgetOnSignOut(forget, env = globalThis) {
  try {
    await turnOff(forget, env);
  } catch {
    // The next account's first page drops a device it does not hold.
  }
}

/** Whether the bell's one prompt was put away on this device. */
const DISMISSED = "elixir.push-prompt";
export function promptDismissed(env = globalThis) {
  try {
    return env.localStorage?.getItem(DISMISSED) === "1";
  } catch {
    return false;
  }
}
export function dismissPrompt(env = globalThis) {
  try {
    env.localStorage?.setItem(DISMISSED, "1");
  } catch {
    // A private window keeps no storage; the prompt just comes back.
  }
}
