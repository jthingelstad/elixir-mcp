# 2026-10-14 — Turnstile on sign-in mail, in observe

Jamie asked for Cloudflare Turnstile on Elixir's email sign-in after the
2026-10-14 subscription bombing elsewhere: a script types a victim's real
address into a public form so our sign-in mail floods their inbox, and
SES is shared with YVN Release Notes, so it costs both products'
reputation. It ships in observe; enforce is a separate decision
(DECISIONS, Email).

## Which flows mail a typed address

Audited every enqueue of mail: only `POST /api/auth` (the website) and
the OAuth door's email step (`/oauth/authorize`, the MCP connector's and
the family apps' sign-in) mail an address someone typed. Welcome mail
goes only after a proved code; `POST /api/request-access` mails only the
owner, and only for a new row; reports, feedback answers, Clan's actions
waiting and a family app's mail go by account or player tag to an
account's own address. Both doors already had the per-caller (10 an
hour, `auth#<ip>`) and per-address (5 an hour) ceilings, shared between
them, so no new limit was added.

## How it works

- The doors read the token (`turnstile_token` in JSON,
  `cf-turnstile-response` in the OAuth form), log `turnstile` on their
  issued and limited lines, refuse a missing one under enforce before
  the ceilings count it, and put `{ surface, token }` on the login
  message. They cannot reach Cloudflare (NAT-free VPC).
- The email relay calls siteverify and keeps the verdict per token in
  the outbox bucket (`mail-delivery/turnstile/`), bound to the address's
  hash, for five minutes and three sends, so "Send another email" with
  the page's token is one check. Every sign-in mail logs one
  `turnstile_checked` line. Under enforce a `fail` is dropped
  (acknowledged, never retried); `error` and `unconfigured` always send.
- Pages: Cloudflare's script loads on the email field's first focus or
  input, rendered explicitly with `interaction-only`; a send waits five
  seconds for a token (two minutes while a challenge shows) and goes
  without one if Cloudflare cannot load. The OAuth page's one inline
  script is allowed by its hash in that page's CSP; the edge CSP allows
  `challenges.cloudflare.com` in `script-src` and `frame-src`.
- Infra: `TurnstileMode` (default `observe`) and `TurnstileKeyInSecret`
  (default `false`) are preserved parameters; the relay alone reads
  `turnstile_secret_key` from `elixir-mcp/app` and may read, write and
  exactly-list `mail-delivery/turnstile/`.
- Widget "Elixir sign-in" (managed, `elixir.poapkings.com`), sitekey
  `0x4AAAAAAFW0ZICrZblLsqht`, made with the cf CLI. Its secret goes into
  the app secret by Jamie's hand (docs/SECRETS.md); until then checks
  record `unconfigured`.

Reading the observe data: docs/OPERATIONS.md, "Sign-in Turnstile".
MCP 11.13.0 and JSON API 3.2.0, unchanged.
