# 2026-11-17 — Close friends' play: Codex's three findings on #1090

- **The privacy page edit is withdrawn.** The page is a legal line and
  changes only with Jamie's word. #1090 edited its Notifications
  paragraph (every notice "says how many, never who" is no longer true)
  before that word, so this change restores the page and the wording
  waits in #1091. Close friends' play should not be deployed before
  #1091 is settled, or the live page promises what the product breaks.
- **A short Ranked climb reaches the build.** The candidate read let a
  short session through only with an event battle, assuming every
  climb also has a profile `ranked_promotion` row. The timeline finds a
  climb from the battles' league stamps alone, so a short session with
  any Ranked battle (`battle.league_number` set) now goes on to the
  build too, which decides. Such a session is built at most once a
  minute until it is two hours old, as a short challenge session was.
- **A retried notice is checked again.** A close friends notice left
  `sending` by a failed outbox write is checked at delivery
  (`closeStillWanted`): every friend it names must still be a close mark
  of the account's, with no block either way with the player's verified
  owner. Otherwise it is dropped like a notice whose kind was switched
  off, and nothing more is written.

No schema change. MCP 13.4.1 and JSON API 5.1.0 unchanged.
