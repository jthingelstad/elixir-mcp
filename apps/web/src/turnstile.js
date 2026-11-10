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

// One script per page, however many forms ask for it. Resolves to the
// Turnstile API, or null when it could not load.
let loading = null;
function loadScript(win, doc) {
  if (win.turnstile) return Promise.resolve(win.turnstile);
  if (!loading)
    loading = new Promise((resolve) => {
      win[ONLOAD] = () => resolve(win.turnstile ?? null);
      const script = doc.createElement("script");
      script.src = TURNSTILE_SCRIPT_URL;
      script.async = true;
      script.onerror = () => resolve(null);
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
        "error-callback": () => {
          failed = true;
          settle();
          return true;
        },
      });
    } catch {
      failed = true;
      settle();
    }
  }

  function warm() {
    if (!win || !doc) return;
    if (api) return render();
    loadScript(win, doc).then((loaded) => {
      if (!loaded) {
        failed = true;
        return settle();
      }
      api = loaded;
      render();
    });
  }

  // Until a token arrives, Turnstile gives up, or the wait runs out; a
  // challenge on screen extends the wait so a person can answer it.
  function wait() {
    return new Promise((resolve) => {
      let timer;
      const done = () => {
        clearTimeout(timer);
        waiters.delete(check);
        report();
        resolve();
      };
      const check = () => {
        if (token || failed) return done();
        clearTimeout(timer);
        timer = setTimeout(done, interactive ? INTERACTIVE_WAIT_MS : WAIT_MS);
      };
      waiters.add(check);
      report();
      check();
    });
  }

  /** The token to send with a sign-in email to `email`, or "" when there
   *  is none to be had. */
  async function tokenFor(email) {
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
      return spent.token;
    }
    if (!win || !doc) return "";
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
    if (!token) await wait();
    if (!token) return "";
    spent = { token, email: key, uses: 1, at: tokenAt };
    return token;
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

  return { warm, tokenFor, dispose };
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
