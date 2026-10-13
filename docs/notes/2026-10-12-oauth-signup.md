# 2026-10-12 — The OAuth door signs in or creates an account; family apps skip consent

MCP 11.11.3 and JSON API 3.2.0 unchanged: no tool, response or `/api/v1`
shape moved. No migration. Step 2 of Jamie's 2026-10-12 reversal of
"Drop is a different thing: its accounts are its own" (step 3, Drop's own
sign-in, is Drop's change).

## Jamie's answer

> "Elixir Drop is different than Elixir as far as it's app goes, but it is
> by the same person and the authentication system is going to merge. You
> can still play Drop without an account, but if you play it with an
> account it will be an Elixir account. We will drop the basic email only
> route."

> "We do need to make sure that whatever page Drop sends for login with
> Elixir allows someone to sign in OR create an account. ... the idea is
> that Elixir Drop gets new users into Elixir."

On sign-in: "you email code to sign into Elixir, then auth with that
existing session". On a consent screen for Drop: "Consent to what? I think
no."

DECISIONS: "A Drop account is an Elixir account" (replaces "Drop's sign-in
with Elixir stays"), "Elixir's OAuth sign-in signs in or creates an
account", "A family app signs a person in with no consent page". The
integrations brief's principle 6 now says the same, and 7 is new.

## What changed

- `/oauth/authorize`'s email step resolves the address with
  `publicLoginAccount`, the website signup's gate, so a new address (or an
  ordinary pending request) is mailed a code and a denied or blocked one
  is sent nothing, behind the same page. The address and the product-news
  box are frozen with the code (`signup_email`, `signup_news`); nothing is
  written to `account`.
- The code step, once the code is proved and bound to this request, calls
  `openVerifiedAccount` as the website's `mintSessionResponse` does, then
  queues the welcome mail when it opened the row (the MCP Lambda now
  carries `sendWelcomeEmail`, the same outbox message). A code proved for
  another request opens nothing. A duplicate submit opens nothing twice
  and welcomes once.
- A provisioned family client (Drop, Clan) asking for the person's own
  door or `/api/v1` gets no consent page: a signed-in browser is sent
  straight back with exactly the requested scope, and the code way lists
  what the app gets with no boxes; posted `grant` values are ignored. This
  replaces the 2026-09-29 standing-grant shortcut that spared only Clan.
  Registered clients, and a family client asking to act as an agent, keep
  the page.
- Copy: the pages say sign in or create an account; the refusal for a
  blocked address matches the console's ("This account cannot sign in",
  contact admin@poapkings.com); "start over from your MCP client" is now
  "the app that sent you here"; the page titles say Elixir, not Elixir MCP.
- Guards: the email step checks the address as the website does
  (`signinAddress`, now in `@elixir-mcp/auth`) and shares the website's
  per-caller ceiling (`signinMailFromAllowed`, bucket `auth#<ip>`, 10 an
  hour, replacing `oauthmail#<ip>`) beside the per-address one it already
  shared. Past either, the page says so, as the website does.

## Product questions and the answers taken

1. **Does the OAuth page ask for a player tag?** No (the brief for this
   step). [engineering, 2026-10-12] No onboarding runs on this door: the
   first Console sign-in runs `onboardAccount`, which lands a tagless
   account on Tracking (#561). The welcome mail points to Tracking too.
2. **Product news.** "Newsletter consent is explicit" puts the box on new
   signup, so the OAuth email page carries it, checked, applied only to a
   new account. [engineering, 2026-10-12] A post without the box (an old
   page) means unticked.
3. **Time zone.** [engineering, 2026-10-12] The door's pages run no
   script (CSP `default-src 'none'`), so a browser zone is not read; an
   account opened here reads in UTC until Profile sets one, per "A new
   account starts on its signup browser's zone" for zone-less accounts.
4. **Which family clients skip consent?** [engineering, 2026-10-12] Every
   provisioned family client, Clan included: Clan is part of Elixir, and
   its old shortcut is a subset of this rule. A family client asking to act
   as an agent or integration keeps the page: that is a different act.
5. **The address.** The accounts brief says the address goes only to a
   family app the person allows. [engineering, 2026-10-12] Choosing "Sign
   in with Elixir" in a family app is taken as that allowance; the code
   page still lists "Know your email address" among what the app gets,
   and Connections ends the grant.
6. **The per-caller ceiling.** [engineering, 2026-10-12] One bucket for
   both doors, so a second door to account creation does not double what
   one caller may send.
