/**
 * Cloudflare Turnstile on the sign-in form (Jamie, 2026-10-14): a token
 * that says a person, not a script, asked for this email. The server's
 * half and the modes are in packages/auth/src/turnstile.mjs; the email
 * relay verifies the token before the mail leaves.
 *
 * Cloudflare's script loads only when someone starts on the email field
 * (`warm`), renders explicitly and stays invisible unless Cloudflare wants
 * a click. A send waits a few seconds for a token, longer while a
 * challenge is on screen, and goes without one if Cloudflare cannot be
 * reached: the server decides what a missing token means.
 *
 * While a send waits, the form is told what for (`onWait`): "challenge" while
 * Cloudflare's box is on screen for a click, "check" otherwise, null when the
 * wait is over. A person looking at the form is never left with a bare
 * "Sending…": a 2026-11-09 walk sat on it for two minutes beside a visible
 * "Verify you are human" box nobody was told to tick.
 *
 * "Send another email" to the same address reuses the token it already
 * sent, inside the five minutes and three sends the relay allows; any
 * other send asks the widget for a fresh one.
 *
 * A send without a token says why (2026-11-28, `fieldsFor`), for the
 * door's log only: `script-blocked` (the script did not load: a content
 * blocker or the network), `script-empty` (it loaded without the API),
 * `error:<code>` (Cloudflare's error-callback, the last one seen),
 * `loading-timeout` / `solving-timeout` (the wait ran out before the script
 * loaded / before it answered), `interactive-timeout` (two minutes on a
 * shown challenge), `no-widget` when none of those applies. Every send
 * says how long it waited. Neither is the address or the token.
 *
 * Cloudflare's error-callback is not the end (2026-11-28): Turnstile
 * retries by itself (retry "auto"), so a retryable error leaves the wait
 * running in the window it already had, and only an error Cloudflare's
 * docs mark as never retried ends it at once. The callback returns
 * nothing, so Cloudflare keeps its default handling and the retry the
 * docs' own example leaves to it.
 */

import { useEffect, useState } from "react";

/** Widget "Elixir sign-in". Public; the server holds the same
 *  (TURNSTILE_SITE_KEY in packages/auth). */
export const TURNSTILE_SITE_KEY = "0x4AAAAAAFW0ZICrZblLsqht";
const ONLOAD = "elixirTurnstileReady";
export const TURNSTILE_SCRIPT_URL = `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=${ONLOAD}`;

/** Under the relay's five minutes, so a reused token is never stale. */
const REUSE_MS = 270_000;
const MAX_USES = 3;
const WAIT_MS = 5_000;
const INTERACTIVE_WAIT_MS = 120_000;

/** Error codes Cloudflare's client-side error table marks "Retry: No"
 *  (sitekey, domain and clock problems): no token follows them. */
const FINAL_ERRORS = new Set([
  "110100",
  "110110",
  "110200",
  "200100",
  "400020",
  "400021",
  "400070",
]);
/** The error code, kept to a small charset for the log. */
const errorCode = (code) =>
  String(code ?? "")
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 12)
    .toLowerCase() || "unknown";

// One script per page, however many forms ask for it. Resolves to
// `{ api }` with the Turnstile API, or `{ api: null, why }` when it could
// not load: `script-blocked` (the tag failed) or `script-empty` (it ran
// without the API).
let loading = null;
function loadScript(win, doc) {
  if (win.turnstile) return Promise.resolve({ api: win.turnstile });
  if (!loading)
    loading = new Promise((resolve) => {
      win[ONLOAD] = () =>
        resolve(
          win.turnstile
            ? { api: win.turnstile }
            : { api: null, why: "script-empty" },
        );
      const script = doc.createElement("script");
      script.src = TURNSTILE_SCRIPT_URL;
      script.async = true;
      script.onerror = () => resolve({ api: null, why: "script-blocked" });
      doc.head.appendChild(script);
    });
  return loading;
}

/**
 * The widget for one form. `slot()` answers the element to render into;
 * the form may swap cards, so a widget whose element left the page is
 * rendered again into the current one.
 */
export function makeTurnstile({
  slot,
  onWait = () => {},
  win = globalThis.window,
  doc = globalThis.document,
  now = Date.now,
}) {
  let api = null;
  let failed = false;
  // Why no token can come (the script, a render, a final error), and the
  // latest error Cloudflare reported, retryable or not.
  let failure = "";
  let lastError = "";
  let widget = null;
  let container = null;
  let token = "";
  let tokenAt = 0;
  let interactive = false;
  let spent = null; // { token, email, uses, at }
  const waiters = new Set();
  const settle = () => {
    for (const waiter of [...waiters]) waiter();
  };
  let said = null;
  const report = () => {
    const now = waiters.size === 0 ? null : interactive ? "challenge" : "check";
    if (now === said) return;
    said = now;
    onWait(now);
  };

  function render() {
    const el = slot();
    if (!api || !el?.isConnected) return;
    if (widget !== null && container?.isConnected) return;
    if (widget !== null) {
      try {
        api.remove(widget);
      } catch {
        // Gone with its element.
      }
      widget = null;
      token = "";
    }
    container = el;
    try {
      widget = api.render(el, {
        sitekey: TURNSTILE_SITE_KEY,
        action: "signin",
        appearance: "interaction-only",
        "refresh-expired": "auto",
        callback: (t) => {
          token = t;
          tokenAt = now();
          failed = false;
          failure = "";
          lastError = "";
          interactive = false;
          settle();
        },
        "expired-callback": () => {
          token = "";
        },
        "before-interactive-callback": () => {
          interactive = true;
          settle();
          report();
        },
        "after-interactive-callback": () => {
          // Answered and being checked: still worth the wait it was given.
          interactive = false;
          report();
        },
        "error-callback": (code) => {
          const c = errorCode(code);
          lastError = `error:${c}`;
          // A retryable error is Cloudflare's to retry: the wait keeps
          // the window it had (no settle, which would start a new one).
          if (FINAL_ERRORS.has(c)) {
            failed = true;
            failure = lastError;
            settle();
          }
          // Nothing returned: Cloudflare's own handling, retry included.
        },
      });
    } catch {
      failed = true;
      failure = "no-widget";
      settle();
    }
  }

  function warm() {
    if (!win || !doc) return;
    if (api) return render();
    loadScript(win, doc).then((loaded) => {
      if (!loaded.api) {
        failed = true;
        failure = loaded.why;
        return settle();
      }
      api = loaded.api;
      render();
    });
  }

  // Until a token arrives, Turnstile gives up, or the wait runs out; a
  // challenge on screen extends the wait so a person can answer it.
  // Answers whether the wait ran out.
  function wait() {
    return new Promise((resolve) => {
      let timer;
      const done = (timedOut = false) => {
        clearTimeout(timer);
        waiters.delete(check);
        report();
        resolve(timedOut);
      };
      const check = () => {
        if (token || failed) return done();
        clearTimeout(timer);
        timer = setTimeout(
          () => done(true),
          interactive ? INTERACTIVE_WAIT_MS : WAIT_MS,
        );
      };
      waiters.add(check);
      report();
      check();
    });
  }

  /**
   * The Turnstile fields for a sign-in email to `email`: `token` ("" when
   * there is none to be had), `waitedMs` and, with no token, `reason`.
   */
  async function fieldsFor(email) {
    const key = String(email ?? "")
      .trim()
      .toLowerCase();
    if (
      spent &&
      spent.email === key &&
      spent.uses < MAX_USES &&
      now() - spent.at < REUSE_MS
    ) {
      spent.uses += 1;
      return { token: spent.token, waitedMs: 0 };
    }
    if (!win || !doc) return { token: "", waitedMs: 0, reason: "no-widget" };
    const started = now();
    warm();
    if (token && token === spent?.token) {
      // Sent once already, for another address or too long ago.
      token = "";
      try {
        if (widget !== null) api.reset(widget);
      } catch {
        // A fresh render below.
      }
    }
    const timedOut = token ? false : await wait();
    const waitedMs = Math.max(0, Math.round(now() - started));
    if (!token) {
      // An error Cloudflare reported says more than the wait after it.
      const reason =
        failure ||
        lastError ||
        (timedOut
          ? interactive
            ? "interactive-timeout"
            : widget !== null
              ? "solving-timeout"
              : api
                ? "no-widget"
                : "loading-timeout"
          : "no-widget");
      return { token: "", waitedMs, reason };
    }
    spent = { token, email: key, uses: 1, at: tokenAt };
    return { token, waitedMs };
  }

  /** The token alone (fieldsFor's), "" when there is none. */
  async function tokenFor(email) {
    return (await fieldsFor(email)).token;
  }

  function dispose() {
    waiters.clear();
    said = null;
    if (widget !== null && api) {
      try {
        api.remove(widget);
      } catch {
        // Gone with its element.
      }
    }
    widget = null;
    token = "";
  }

  return { warm, tokenFor, fieldsFor, dispose };
}

/** The form's half: `slot` is the ref for the element the widget renders
 *  into, `warm` goes on the email field's first focus or input, and
 *  `waiting` says what a send is waiting for ("challenge", "check" or null). */
export function useTurnstile() {
  const [waiting, setWaiting] = useState(null);
  const [turnstile] = useState(() => {
    let el = null;
    return {
      ...makeTurnstile({ slot: () => el, onWait: setWaiting }),
      slot: (node) => {
        if (node) el = node;
      },
    };
  });
  useEffect(() => () => turnstile.dispose(), [turnstile]);
  return { ...turnstile, waiting };
}

/** For tests: forget the page's script. */
export function resetTurnstileScript() {
  loading = null;
}
