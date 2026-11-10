# 2026-11-09 — Sign-in names Cloudflare's box while a send waits on it

A production walk tonight pressed "Send sign-in email" in an automated
Chromium and watched the button read "Sending…" for 121.8 s before the email
went without a Turnstile token (observe mode sent it).

What was on screen, reproduced on the same machine against production
`/signin` without submitting (no write: requests to Elixir other than GET
were refused): the widget turns interactive about 1.5 s after the email field
is first touched (`before-interactive-callback`), and Cloudflare's "Verify you
are human" box is drawn in full, directly above the button (probed at 1180 px; the slot is
the same element at phone width). Nothing on the form said the send was waiting for it, and the
button said "Sending…". Unclicked, the widget raises no error, so the form
waited the full `INTERACTIVE_WAIT_MS`. Clicked, with Cloudflare's challenge
host `brunhild.challenges.cloudflare.com` unreachable (as it is from that
machine), the widget answers `after-interactive` and then `error-callback`
600010 about 3 s later, and the existing code already sends at once; the
widget then turns interactive again by itself about 11 s later.

What changed (web only):

- `makeTurnstile` takes `onWait` and says what a send is waiting for:
  `"challenge"` while the box is on screen, `"check"` otherwise, `null` when
  the wait ends. `useTurnstile` returns it as `waiting`.
- While a send waits on the box, the button reads "Waiting for the check…" and
  a status line beside the box says Cloudflare is asking for one click and the
  email goes once it is answered (both the email form and the code card's
  "Send another email").
- Unchanged: the 120 s wait for a box on screen, the 5 s wait otherwise, the
  prompt send without a token when the script cannot load or the widget
  errors, and observe mode (DECISIONS, "Sign-in mail carries a Turnstile
  check").

This walk is also a `missing` the observe log can now partly explain: a
browser that cannot reach the challenge host gets an interactive box whose
answer fails (600010), and a person who does not tick the box sends nothing
for two minutes and then sends without a token.
