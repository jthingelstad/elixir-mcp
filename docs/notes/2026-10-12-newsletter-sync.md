# 2026-10-12 — `{newsletter_sync}`: the mailing list catches up with the accounts

No MCP or JSON API change, no migration: an operator op and a relay
message kind.

The relay enrolls an account with Buttondown only when it sends that
account a sign-in or welcome mail and the account opted in. Accounts made
for people with `{account_enroll}` (the 13 Elixir Drop players enrolled
today, `2026-10-12-enroll-without-a-tag.md`) get no such mail, so they
were not on the list. Jamie asked for a one-time sync of Elixir's
accounts to the list, those 13 included: Elixir's list is to be the one
list (Drop's retires; Drop's own subscribers are a later step).

- The jobs Lambda's `{newsletter_sync}` (it has the database and the
  outbox; the migrate Lambda has no outbox) counts, or hands over, one
  `{kind: "newsletter_enroll", to}` message per approved person account
  with `newsletter_opt_in` on and an address.
- The relay enrolls each with the same request a sign-in uses: an address
  Buttondown already has, an unsubscribed one included, is left alone, so
  an unsubscribe is never overridden and a rerun is harmless. No mail is
  sent. A Buttondown failure is a log line, never a retry; an address that
  is not one dead-letters as a bad message.
- No address appears in the op's answer or any log line.

Later the same night: the dry run also names the approved people it
leaves off, by the 10-character email-hash prefix `{account_role}` lists
(`skipped.opted_out`, `skipped.no_address`), so Drop's retired list could
be checked against Elixir's without reading an address (Drop step 4).
