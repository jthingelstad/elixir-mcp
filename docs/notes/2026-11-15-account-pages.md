# 2026-11-15 — Account pages, account follows and the three player states

Migration 0277. No MCP tool, `/api/v1` operation or contract version
changes (MCP 13.2.2, JSON API 5.1.0).

**Direction.** Jamie, 2026-11-15: a player is Imported ("followed by
someone, so Elixir is importing"), Claimed ("attached to an account but
not verified") or Verified ("attached to an account and verified"). A
grey ring marks Claimed; gold stays Verified. Accounts get pages at
`/home/account/<id>`, with the passport under them at
`/home/account/<id>/passport`; the passport and the place belong to the
account. "Accounts can be followed just like players… if you follow an
account you should see their passport stamps and any other activity that
comes from the account level, setting location is one." "A claimed player
should link to the player claiming it. This is important so you know what
account is making the claim." And: "verifying a player means NOBODY else
can claim it. So an account verifying a player is a timeline event that
is really important." "Approved to build this."

**What changed for people.**

- A Claimed player wears a grey ring (`kit-av--claimed`) wherever a
  verified one wears gold; `player_claims` rides beside
  `player_verifications` on the reads that carry them.
- A player's page says Verified by, Claimed by (every claimant) or
  Imported, each claimant linking to its account page. Once a player is
  verified, only the verifier is named.
- An account page: the account's primary and alts with their states,
  badges, place (city at most, through Clan's seam), follows and
  followers, Stamps with Open passport, and one 30-day timeline of its
  players and its own news. Follow is one tap and takes no player slot.
- Following an account brings its news to Home: `player_verified`,
  `stamp_earned` (live grants only, never "Earned before") and
  `place_set`. People items take no cheer.
- You gains **Your account page**. Old `/home/passport/<id>` addresses
  stop working ("fine to break url support"); `/home/passport` is still
  your own.

**How.**

- The page id is the account's passport id (twelve random characters,
  0269); migration 0277 adds `account_follow` and backfills a passport for
  every person account so every account has a page id. Never the account
  UUID or `account.public_id`.
- People items are their own timeline section, `people`, visibility
  `member`, built only when `buildTimeline` is asked with `people`: Home,
  the player page and the account page. MCP, the digest, RSS and Discord
  never ask, so the timeline tool's kinds and docs do not change
  (`PEOPLE_KIND_SCHEMAS` sits apart from `TIMELINE_KIND_SCHEMAS`).
- Home's stored week keys on followed accounts too, so a follow or
  unfollow rebuilds it.
- `packages/tools` now reads `packages/stamps` for stamp items, in three
  files the stamps boundary test names.
- `/api/player` spends two more statements (33): its claimants, and its
  verification as a people item.
- Removing an account removes its account follows both ways.

**Product questions this raises** `[engineering]`, taken from the brief
and direction rather than asked:

- An account page is shown to any signed-in member, like a passport.
- The page names an account by its primary player's game name; with no
  claims it has no name and shows only its page id's content.
- A Claimed player claimed by several accounts lists every one, oldest
  claim first.

**Follow-up (Codex on #1061).** A followed account's people items sit
under Home's Friends chip, not You, even when the reader follows none of
its players; and an account page's Following counts followed accounts as
well as players.
