# 2026-10-16 — The relay reads the suppression list, not one address at a time

The relay's suppression check (`2026-10-16-live-errors.md`) asked SES
about each recipient before sending. SES's API actions other than
sending share one request a second, so a burst of mail would be
throttled, and a throttled lookup sends anyway: the burst would bypass
the guard it was built for (Codex review on #594).

The check now reads the whole account list, once per environment every
five minutes, with concurrent callers sharing one read. A failed read
keeps the last list it had and waits 30 seconds before trying again;
with no list yet, the mail sends as before and the relay logs
`suppression_check_failed`. The relay role trades
`ses:GetSuppressedDestination` for `ses:ListSuppressedDestinations`. An
address added to the list is skipped within five minutes. No contract,
JSON API or migration moves.
