# 2026-11-14 — The bell names a follower by the player they claim

The followers list on a player page names a follower who has not verified
a player by the player their account claims, marked not verified (#1030,
Jamie 2026-11-14). The bell, rebuilt in #1009, still counted every such
follower in "N more followers with no verified player". It now matches:

- `services/web-api/src/bell.mjs` `readFollowers` picks the follower's
  player with the same rule as `followersOf` in `packages/tools/src/social.mjs`:
  the verified primary or alt first, else a primary or alt claim no other
  account verified (a claim on a tag another account verified names nobody).
  Each row carries `verified`; a new `no_player` counts accounts with no
  player at all. Still one statement; the bell's statement budget test is
  unchanged and passes.
- The bell row is "{name} follows you" (or "follows {player}" with more
  than one player), with "Not verified" under it and no gold mark
  (`PlayerName verified={false}`), and **Follow back** as for anyone.
- The counted line is only for accounts with no player:
  "N more followers with no player added yet", plus "N more, not listed
  here" past the list's cap. An older read with no `no_player` or
  `verified` reads as before.

Web door only (the bell has no MCP tool): MCP 13.2.0 and JSON API 5.1.0
unchanged.
