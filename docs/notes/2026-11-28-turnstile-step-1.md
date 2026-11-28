# 2026-11-28 — Turnstile on sign-in mail: four fixes nobody sees

Step 1 toward enforce. A 14-day read of the observe log (to 2026-11-28)
held 20 sign-in mails that passed and 6 real ones sent with no token,
and nothing said why. These four change no word, layout, wait or mode;
`TurnstileMode` stays `observe`.

1. **Hostname and action are checked.** Cloudflare's siteverify docs
   say to validate both. The relay (`services/email-relay/src/turnstile.mjs`)
   now fails a success whose `hostname` is not `elixir.poapkings.com`
   (`hostname-mismatch`) or whose `action` is not its door's
   (`action-mismatch`; `signin` for the website, `oauth-signin` for the
   OAuth email step, `TURNSTILE_ACTIONS` in `packages/auth`). Every fresh
   pass in the 14 days carried both. The kept verdict stores the result
   after the check, and the action, so a resend is judged as the first
   send was and a token kept at one door fails at the other.
2. **Why a token is missing.** Both pages send `turnstile_reason` with
   no token (`script-blocked`, `script-empty`, `error:<code>`,
   `loading-timeout`, `solving-timeout`, `interactive-timeout`,
   `no-widget`; the OAuth form is served with `no-script` in a hidden
   field its script replaces) and `turnstile_wait_ms` with every send,
   after Release Notes' `web/src/lib/turnstile.ts`. The doors log them
   beside `turnstile` on `signin_code_issued`, `oauth_code_issued`,
   `signin_mail_limited` and `turnstile_refused`, checked to a small
   charset (`turnstileWhyFrom`); they never ride to the relay and decide
   nothing. The OAuth page's inline script changed, and its CSP hash is
   computed from it as before.
3. **Cloudflare's first error is not the end.** Turnstile retries by
   itself (`retry: "auto"`), every 8 s by default, longer than the 5 s
   wait, so both renders now pass `retry: "auto"` and `retry-interval`
   2000 (`TURNSTILE_RETRY_INTERVAL_MS`, as Road Sign Math does). Both pages used to end
   the wait on any `error-callback` and send with no token, which lost
   Release Notes a real sign-in to a retryable `600010`. Now a retryable
   error leaves the wait running in the window it already had (5 s, or
   120 s while a box shows); only the codes Cloudflare's error table
   marks "Retry: No" (110100, 110110, 110200, 200100, 400020, 400021,
   400070) end it at once, and a wait that runs out sends the last error
   code as its reason. The callback now returns nothing: Cloudflare's
   docs say a truthy return only means "handled, do not log", and their
   retry example returns false to "let Turnstile handle the retry", so we
   leave it Cloudflare's default.
4. **siteverify gets an `idempotency_key`**, a UUID (version 5) derived
   from the outbox key and the token's hash. A queue retry after a
   verdict store failed asks again as the same request, so Cloudflare
   gives its first answer instead of `timeout-or-duplicate`, which would
   have counted a real person as `fail`.

Cloudflare's own failures (HTTP, timeout, `internal-error`, a rejected
secret) stay `error`, which every mode sends. No contract, migration,
MCP or JSON API change.
