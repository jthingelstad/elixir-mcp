# 2026-10-20 — Turnstile on sign-in mail enforces

`TurnstileMode` moves from `observe` to `enforce` (Jamie, 2026-10-20),
by a deploy with `--param=TurnstileMode=enforce`; the parameter is
preserved, so later deploys keep it. The evidence: every sign-in mail the
relay logged from the secret's deploy (2026-10-14) to the flip was `pass`
(three web, one OAuth), with no `missing`, `fail` or `error`, and the
doors logged a token on each. A small sample; the refusals now show as
`turnstile_refused` at the doors (docs/OPERATIONS.md, "Sign-in
Turnstile"), and the way back is `--param=TurnstileMode=observe`.

The site's limits page and a product update say what a person sees.
MCP 11.13.1 and JSON API 3.2.0, unchanged.
