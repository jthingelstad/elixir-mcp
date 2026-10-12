# 2026-10-12 — Signup takes an optional player tag

MCP and JSON API unchanged (`packages/contracts` untouched). No migration:
`account.requested_player_tag` already exists. Deployed with no acceptance
family: no tool's behaviour changed, only the sign-in route, the account
insert and the Console.

VISION priority 3 (shorten the first-use journey). The signup form
(`?signup`, and plain sign-in's "New here? Create an account") has an
optional **Your player tag** field; plain sign-in has none.

- **At the request.** `POST /api/auth` reads `player_tag` and normalizes it
  with the contracts normalizer (golden rule 4). A malformed tag is a 400
  `invalid_tag` before the rate limits and before any mail; blank is no
  tag. The tag is frozen as `signup_player_tag` in the magic login's
  context, beside `signup_news` and `signup_zone`.
- **After proof.** The link and code routes pass it to
  `openVerifiedAccount`, whose insert writes `requested_player_tag`; the
  pending-member update and an existing account ignore it, as they ignore
  the news choice and zone. `onboardAccount` then does what it always did
  with a requested tag (claim it as primary, follow its clan once), and is
  unchanged except that its result now names the tag. Nothing is claimed,
  read or followed for an address that never verifies.
- **First read.** When onboarding claimed the player, the mint asks for its
  first read (`requestFirstRead`, as Tracking's add does), so the capture
  or **Tag not found** shows within seconds. It spends the pool's daily
  first reads like any add.
- **Rate limits.** The path is the sign-in path: the per-IP `auth#<ip>`
  bucket (10 an hour) and the per-address `signinMailAllowed` still bound
  every mail. A refused tag sends nothing, so it needs no bucket of its own.
- **Landing.** A creating proof returns `new_account: { player_tag }`
  (redeem and code). A remembered `return_to` still wins; otherwise an
  account with a claimed tag lands on its Tracking record (the Pending /
  FirstAnswer flow, and **Tag not found → Fix the tag** for an unknown
  tag), and one without lands on `/console/account/tracking#add-player-tag`
  with the field focused. A cross-device collection (the asking screen's
  poll) lands on Overview as before: the poll mints without the proof's
  context.
- **A brand-new tag's clan.** For a player not yet observed, `addPlayer`
  writes the player row with no clan, so onboarding finishes at once and
  the clan is followed by `followClanForPlayer` when the first profile
  lands (`auto_follow_clan` is on for new accounts). Pinned in
  `public-signup.test.mjs`.

Assumption, confirmed by Jamie on 2026-10-12: the landing pages above
(a tag → its record; none → Tracking with the tag field focused).

Tests: `services/web-api/test/public-signup.test.mjs` (frozen then claimed,
clan once, a second sign-in does nothing; malformed refused before mail;
empty is no tag; an unseen tag), `packages/auth/test/auth.test.mjs` (the
insert writes the tag, the update does not), the web sign-in and landing
tests, and the e2e signup journey.
