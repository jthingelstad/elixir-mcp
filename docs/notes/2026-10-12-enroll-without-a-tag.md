# 2026-10-12 — `{account_enroll}` takes people with no player tag

No MCP or JSON API change, no migration: an operator op only.

Jamie decided on 2026-10-12 that an Elixir Drop account becomes an Elixir
account: Drop keeps guest play, drops its email-only sign-in, and signs in
through Elixir. Of Drop's 25 players, 12 already had an Elixir account.
Jamie asked that the rest be enrolled now rather than wait for their next
visit, without a player tag, and put on Elixir's mailing list. Most never
saved a tag in Drop, and some do not play Clash Royale.

`{account_enroll}` refused an entry without a tag. Now:

- An entry with no `player_tag` (absent, null or empty) gets the account a
  signup with an empty tag field gets: approved member, no claim, no clan,
  `onboarded_at` left for `onboardAccount` to stamp at first sign-in, so
  the Console opens on Tracking. A `clan_tag` with no `player_tag` is
  refused for that entry. `fill_empty` never fills from a tagless entry.
- `newsletter_opt_in` (op level, boolean) is written on every account the
  run creates. Absent, the column default (true, since 0051) stands, as
  before. It marks the account only: the email relay joins Buttondown
  after a sign-in or welcome mail, and enrollment sends neither, so a list
  import is a separate step.

Codex review of #560, answered the same day:

- `onboarded_at` alone did not land them on Tracking: the sign-in answer's
  `new_account` came only from the verification that created the account.
  It now also comes from the first sign-in to an account made for the
  person, which is the one sign-in where onboarding claims the requested
  player or, with none, stamps the account.
- `newsletter_opt_in` is written in the account's insert rather than an
  update after it, so a failed second statement cannot leave the default
  behind on an account a retry would then skip.
