# 2026-11-12 — Joining from a link, and the 13-or-older question

Social slice 5 (#763, tracker #752, plan note
`2026-11-11-social-build-plan.md`). VISION.md (Jamie, 2026-11-11):
"Signing up asks the person to attest they are 13 or older." DECISIONS:
"Free public signup; collector admission stays governed", "Invites carry
no referral ids", "A battle has its own page", "Everyone signs in; shared
posts stay public", "A follow costs a slot only when Elixir records the
player because of you".

## What changed

- **The way in.** A signed-out reader of `/battle/<id>` or `/h/<id>` gets
  one panel, high on the page: **Join Elixir** (gold, the signup form),
  **Sign in** (solid) and **What is Elixir?** (quiet), each carrying
  `return_to=<this page>` through the existing sign-in return. No second
  sign-in, no referral id: the link names the page and nothing else. A
  post's panel names its player ("Follow <name> on Elixir"). The signed-out
  page shows nothing it did not before; the public-boundary and
  no-account-id tests stand unchanged.
- **Follow from here.** Signed in, the same pages list the page's players:
  a post's player first, then the rest of its battle; a battle's left
  (recorded) side first, then the right. The reader's own players
  (primary, alt) are left out; one already followed says **Following**.
  Each row reads `GET /api/me/follow-cost` (#760) and says Free or Uses a
  slot before the tap, and **Follow** is Home's own (`POST /api/claims`,
  relationship `friend`); a full pool disables it. An account with no
  player of its own is asked to add it first, as Home's Friends tab asks.
  Suggestions come only from the page's content.
- **Migration 0241, the attestation.** `account.age_attested_at` and
  `discord_login.signup_age_attested_at`, both nullable `timestamptz`,
  catalog-only, `lock_timeout` 5 s. Nothing fills earlier accounts.
- **Every door that opens an account asks.**
  - Web email: the signup form asks "Are you 13 or older?" (Yes required).
    No disables the send and says nothing was sent or saved; nothing
    reaches the server. `POST /api/auth` takes `age_13`: `false` is 403
    `under_13` before the address is parsed, rate-limited, logged or
    stored; a non-boolean is 400. `true` freezes
    `signup_age_attested_at` (the send's time) in the `magic_login`
    context, as the zone and news box are.
  - Discord: `/api/auth/discord/start?age=1` from the signup form carries
    it on the `discord_login` row.
  - The OAuth sign-in page (`/oauth/authorize`): an **I am 13 or older**
    box on the email step.
  - `openVerifiedAccount` opens no account without it: it returns
    `age_attestation_required` and writes nothing. An existing account
    signs in as before. Web code and link answer 403
    `age_attestation_required` with no session; the page returns to the
    signup form with the address kept and a note. Discord's callback
    redirects to `/signin?signup&discord=age`. The OAuth page refuses the
    code with a plain reason.
- **Docs.** Your account, Quickstart, Sign in with Elixir, Privacy, and the
  battle model's page section.

## Defaults taken [engineering, 2026-11-12]

- The attestation is a time, not a flag: when the asking form was sent,
  written only when the proof opens the account. A pending member that
  becomes open keeps an earlier time if it has one.
- Plain sign-in opens no new account (it never asked); the reader is sent
  back to the signup form with one new email to send.
- The answer is not kept across a reload of the signup form; it is asked
  again.
- Accounts made by an admin's enrolment are not asked and keep none.
- Follow from here shows to any signed-in reader of the page, not only a
  new account; it adds a friend, never a primary.

## Versions

Migration 0241. MCP and `/api/v1` unchanged (`/api/auth` is the app's own
door, outside the contracts).
