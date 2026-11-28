/**
 * Cloudflare Turnstile on the sign-in mail (Jamie, 2026-10-14): is a
 * person asking us to send this email?
 *
 * Both doors that mail a typed address (the website's `/api/auth` and
 * the OAuth door's email step) take a Turnstile token from the page.
 * Subscription bombing is why: bots type a victim's real address into
 * public forms so our mail lands in the victim's inbox, and SES is shared
 * with YVN Release Notes, so it costs both products' reputation.
 *
 * The doors cannot ask Cloudflare: they reach only the NAT-free VPC. The
 * token rides the login message through the outbox, and the email relay,
 * the one function with internet, verifies it before it sends
 * (services/email-relay/src/turnstile.mjs). The doors decide only what
 * needs no answer from Cloudflare: under enforce, a request with no token
 * is refused before it spends anyone's sign-in mail ceiling.
 *
 * Modes (`TURNSTILE_MODE`, default `observe`):
 * - `observe` verifies and records every token and refuses nobody.
 * - `enforce` refuses a missing token at the door and a failed one at
 *   the relay. A Cloudflare outage, a rejected secret or no secret still
 *   sends. A Cloudflare script outage is a missing token, which enforce
 *   refuses: that is why enforce is its own decision.
 * - `off` skips the check.
 */

/** Widget "Elixir sign-in" (managed, elixir.poapkings.com). Public: every
 *  sign-in page carries it. apps/web/src/turnstile.js holds the same. */
export const TURNSTILE_SITE_KEY = "0x4AAAAAAFW0ZICrZblLsqht";
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
/** Where the widget draws: siteverify's `hostname` for a real token.
 *  Cloudflare says to check it, and the relay does (2026-11-28). */
export const TURNSTILE_HOSTNAME = "elixir.poapkings.com";
/** The `action` each door's page draws its widget with, which siteverify
 *  echoes back; the relay fails a pass whose action is another door's.
 *  apps/web/src/turnstile.js draws "signin"; the OAuth email step's
 *  inline script (services/mcp oauth-routes.mjs) draws "oauth-signin". */
export const TURNSTILE_ACTIONS = Object.freeze({
  web: "signin",
  oauth: "oauth-signin",
});
/** Flip with the TurnstileMode stack parameter, never here. */
export const DEFAULT_TURNSTILE_MODE = "observe";
/** Cloudflare documents a 2048-character maximum. */
export const TURNSTILE_TOKEN_MAX = 2048;

export function turnstileMode(env = process.env) {
  const raw = String(env.TURNSTILE_MODE ?? "")
    .trim()
    .toLowerCase();
  return raw === "off" || raw === "observe" || raw === "enforce"
    ? raw
    : DEFAULT_TURNSTILE_MODE;
}

/** Enforce refuses only a token that is absent or that Cloudflare
 *  rejected; every other result goes ahead. */
export function turnstileAllows(mode, result) {
  if (mode !== "enforce") return true;
  return result !== "fail" && result !== "missing";
}

/** The token a page sent: `turnstile_token` (JSON) or the widget's own
 *  form field, `cf-turnstile-response`. Empty when there is none. */
export function turnstileTokenFrom(body) {
  const raw = body?.turnstile_token ?? body?.["cf-turnstile-response"] ?? "";
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, TURNSTILE_TOKEN_MAX);
}

/** The longest wait a page reports: its two-minute challenge window,
 *  with room for a slow tab. Anything larger is not believed. */
const WAIT_MS_MAX = 600_000;

/**
 * What the page says about its token, for the door's log only
 * (2026-11-28): `turnstile_reason`, why it sent none (`script-blocked`,
 * `script-empty`, `error:<code>`, `loading-timeout`, `solving-timeout`,
 * `interactive-timeout`, `no-widget`; the OAuth form's `no-script` when
 * its script never ran), and `turnstile_wait_ms`, how long the send
 * waited for Cloudflare. Never trusted: a reason outside a small charset
 * is `invalid`, a wait that is not a sane whole number is left out, and
 * a reason beside a token is dropped. Neither decides anything.
 */
export function turnstileWhyFrom(body, hasToken) {
  const out = {};
  const rawWait = body?.turnstile_wait_ms;
  const wait =
    typeof rawWait === "number"
      ? rawWait
      : typeof rawWait === "string" && /^\d{1,6}$/.test(rawWait.trim())
        ? Number(rawWait.trim())
        : NaN;
  if (Number.isInteger(wait) && wait >= 0 && wait <= WAIT_MS_MAX)
    out.turnstile_wait_ms = wait;
  if (!hasToken) {
    const raw = body?.turnstile_reason;
    if (typeof raw === "string" && raw.trim()) {
      const reason = raw.trim();
      out.turnstile_reason = /^[a-z][a-z0-9:-]{0,39}$/.test(reason)
        ? reason
        : "invalid";
    }
  }
  return out;
}

/**
 * The door's half, before any mail ceiling is counted: what rides the
 * login message (`turnstile`, or null when the mode is off), what the
 * door's log line says (`seen`: token or missing; `log`, the fields its
 * lines carry: `turnstile` and the page's `turnstileWhyFrom`), and
 * whether to refuse now (enforce and no token).
 */
export function turnstileAtDoor(body, surface, env = process.env) {
  const mode = turnstileMode(env);
  if (mode === "off")
    return {
      mode,
      seen: "off",
      log: { turnstile: "off" },
      refuse: false,
      carry: null,
    };
  const token = turnstileTokenFrom(body);
  const seen = token ? "token" : "missing";
  return {
    mode,
    seen,
    log: { turnstile: seen, ...turnstileWhyFrom(body, !!token) },
    refuse: !turnstileAllows(mode, token ? "pass" : "missing"),
    carry: { surface, token },
  };
}

/** What a refused person is told, at either door. */
export const TURNSTILE_REFUSED_MESSAGE =
  "Elixir could not confirm a person asked for this email. Reload the page and try again.";
