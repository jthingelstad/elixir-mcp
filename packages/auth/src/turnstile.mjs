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
/** Flip with the TurnstileMode stack parameter, never here. */
export const DEFAULT_TURNSTILE_MODE = "observe";
/** The doors that mail a code, as the relay's log names them. */
export const TURNSTILE_SURFACES = ["web", "oauth"];
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

/**
 * The door's half, before any mail ceiling is counted: what rides the
 * login message (`turnstile`, or null when the mode is off), what the
 * door's log line says (`seen`: token or missing), and whether to refuse
 * now (enforce and no token).
 */
export function turnstileAtDoor(body, surface, env = process.env) {
  const mode = turnstileMode(env);
  if (mode === "off") return { mode, seen: "off", refuse: false, carry: null };
  const token = turnstileTokenFrom(body);
  return {
    mode,
    seen: token ? "token" : "missing",
    refuse: !turnstileAllows(mode, token ? "pass" : "missing"),
    carry: { surface, token },
  };
}

/** What a refused person is told, at either door. */
export const TURNSTILE_REFUSED_MESSAGE =
  "Elixir could not confirm a person asked for this email. Reload the page and try again.";
