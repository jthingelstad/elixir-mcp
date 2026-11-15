# Linked follows

Jamie, 2026-11-15: "if you follow a player you also follow the account. If
you follow the account you follow ALL players that account has." Approved
as: "a Verified player's follow is its account's follow, an account follow
covers its Verified players now and later, Claimed and Imported stay
player-only, existing follows convert as recommended".

## What it does

- `packages/claims/src/linked.mjs` holds the link. Following a Verified
  player (web Follow, Follow all, `elixir_follow_player`) runs
  `linkAfterFollow`, which follows the verifying account
  (`account_follow`) and each of its other Verified players.
- Following an account (`POST /api/me/account-follows`) follows its
  Verified players. Verifying a player (`routes/verify.mjs`) runs
  `linkNewVerified`, so every follower of the account follows it too, and
  everyone who already followed that player (while it was Claimed or
  Imported) now follows the account and its other Verified players.
- Unfollowing the account, or a Verified player of an account the reader
  follows, ends it all (`unfollowAccountLinked`). A player the reader
  claims as their own, or watches, is never touched.
- Only the verifier links. Anyone can claim any player, so a Claimed
  player never pulls in an account.

Each player follow is an ordinary friend claim written by `addPlayer`, so
slots, recording, MCP and the digest see nothing new. A player the link
cannot take (`no_free_slot`, `no_own_player`) is skipped and logged as
`follow_skipped`, which the bell shows. In practice a linked player is
always free (its owner's verified claim records it), so `no_own_player` is
the skip people meet.

## Before the tap

`GET /api/me/follow-cost` adds `linked: {players, slots}` for a Verified
player, and the Follow dialog says what comes along. An account page's
Follow is now a confirm dialog priced by `you.plan` (the same plan a
clan's Follow everyone reads); Unfollow says the whole link ends.

## Conversion

`{linked_follow_convert}` (dry run reads; `apply: true` writes) links each
person who already followed a player another account verified, through
the same live path (via `convert`), once after the deploy. It also
catches up account follows made before linked follows, which followed no
players (Codex on #1063). Counts only.

## Product questions, decided as [engineering]

- A verified player that later leaves its account keeps its followers'
  friend claims; nothing unfollows them.
- The conversion's `account_followed` lines reach each reader's bell, so
  nobody is followed into an account silently.

MCP 13.3.0.
