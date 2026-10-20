# 2026-10-20 — Turnstile on sign-in mail back to observe

`TurnstileMode` went to `enforce` at 14:01 Central and back to
`observe` at 14:26 (Jamie, both the same day), by deploys with
`--param=TurnstileMode=…`. No sign-in reached either door in between,
so nobody was refused.

Why: YVN Release Notes runs the same design (Cloudflare's script loads
on the email field's focus, a missing token refused under enforce), and
its observe log from 2026-10-14 held four `missing` against three
`pass`, every one a real person who finished signing in. Elixir's four
`pass` cannot rule that out. Enforce waits until a `missing` result
says why (never loaded, loading, timed out, errored) and the numbers
are read again.

The limits page row goes back to "none yet", and the update announcing
enforce (live 25 minutes) is withdrawn. MCP 11.13.1 and JSON API 3.2.0,
unchanged.
