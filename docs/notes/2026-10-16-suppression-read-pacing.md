# 2026-10-16 — The suppression read waits out SES's rate

A follow-up to `2026-10-16-suppression-list-read.md`, from its Codex
review on #595. Each relay environment reads the list on its own, so a
burst that starts several environments cold at once can still meet
SES's one-request-a-second rate for its actions other than sending, and
a list longer than one page asked for its pages back to back.

The read's client now retries a throttle up to four times, not twice,
with the SDK's jittered backoff. That spreads the colliding reads over
a few seconds, well inside the relay's 60 s timeout. The pages wait
1.1 s between them. A read that still fails keeps the last list or,
with none, sends as before and logs `suppression_check_failed`, so a
fail-open shows in the relay's log. Coordinating one read across
environments (a shared cache) would be a new store for a list of three
addresses, and is not built. No contract, JSON API or migration moves.
