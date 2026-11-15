# 2026-11-14 — Unverified followers shown; player-page moments link their battle

The owner's feedback, two items on the player page.

## Followers

The Followers list said "1 more account has no verified player, so it is
counted, not named." The owner: unverified followers should be shown, as
the player they claim, plainly marked as not verified.

- `followersOf` (`packages/tools/src/social.mjs`, read by the player page
  and `players_follows`) names a follower by the player its account
  verified, else by the player it claims (its primary, else an alt) with
  `verified: false`. A claim on a tag another account verified names
  nobody: that account is the player. `no_player` counts the accounts
  with no player at all; `unnamed` still counts every follower not
  listed (those plus any past the 100 cap).
- The page draws a claimed follower as the player, with the tag and
  "Not verified" under the name, no gold mark and no profile image (the
  image belongs to verified players: the avatar read skips claimed rows).
  Accounts with no player are one unlinked row: "An Elixir account" or
  "N Elixir accounts", "No player added yet". Followers past the cap read
  "And N more, not listed here."
- Privacy: nothing new is revealed. Who follows a player was public
  already; the claimed player is a tag and its game name, which are game
  data. No nickname, email, Discord or account id.
- MCP 13.2.0 (minor): `players_follows` `followers.players[].verified`
  and `followers.no_player`.
- The bell's new-follower line still counts unverified followers; the
  bell is being redesigned in another session, which can follow this.

## Moment battles

Home's feed already linked a moment the record proved (`battle_url`, from
`promoted_by`/`crossed_by`/`best_win`). The player page's `pageItem` gave
a link only to highlights, so its Moments and Timeline tabs drew no
"Open the battle" though the view would have. `readPlayerPage` now runs
`proofOf` over the page's items and `battleLinks` once for them, as
Home's `annotateFeed` does. A moment with no proof gets no link.

The page's read adds one statement when the window holds a proved moment,
none otherwise.

No migration. JSON API 5.1.0 unchanged.
