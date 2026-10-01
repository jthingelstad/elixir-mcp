# 2026-10-01 — Elixir Operator

## Arena-week mail repair

- **Preflight:** observation available, this worktree mutation-eligible, and
  the production lease free at `origin/main` `1dea023c`.
- **Incident receipt:** the September 29 arena-week jobs invocation logged 16
  `email_compose_failed` records. Each failed while the builder called `.map`
  on `cards` from a `battles_decks` list row.
- **Cause and repair:** list rows intentionally expose `card_names`; full card
  objects only arrive when one `deck_hash` is requested. The arena builder now
  reads `card_names` for list rows and retains object rendering for a full row.
- **Coverage:** the focused mail test covers both declared shapes. `npm run
  verify` passed.
- **Production read-back before deployment:** public status was healthy with
  no dead ledger jobs or outbox DLQs, five active signed v3.0.6 collectors,
  zero current-hour fetch errors, and no firing `elixir-mcp-*` alarms. The
  previous 24-hour error census contained 331 mostly 503 responses, but the
  scheduler was current and its held cursors had self-healed; watch the next
  operator run rather than forcing collector work.
- **Acceptance:** do not replay or force the missed arena-week mail. After the
  runtime repair deploys, the next natural arena-week schedule is the proof
  that composition succeeds.
