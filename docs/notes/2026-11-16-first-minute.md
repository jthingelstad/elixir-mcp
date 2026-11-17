# 2026-11-16 — A newcomer's first minute, and a second polish pass

Presentation and plainer copy only. No change to who sees what, what is
promised, who receives mail, what earns a Stamp, or any MCP or JSON API
contract.

## The first minute

- **Sign-in and sign-up** say "your digest has its own off switch" once,
  beside the product-news box. The product-news default is unchanged.
- **The new-account welcome** drops "First read" and "the game keeps
  about your last 30 battles" for "Add your player tag, and your battles
  show up here within about a minute." **Connect an AI** is no longer a
  welcome step (it was never one of the six counted profile steps and
  earns no Stamp); it stays in Settings › Connections & agents and the
  docs.
- **Verify** in a challenge is three numbered steps (build the deck, play
  one battle, come back), with one line of header. Waiting reads "Waiting
  for your battle. Nothing new yet, and that is fine: play when you are
  ready." The facts are unchanged: any mode counts, the page checks every
  15 seconds, the challenge stays open an hour.

## Stats

- `PanelNote` (`apps/web/src/stats/common.jsx`) shows a panel's first
  sentence and puts the rest, every word kept, under "More about these
  numbers". A panel with a lede puts its whole note there.
- **Most played deck** keeps its height while the cards load:
  `DeckGridWait` in the kit draws eight quiet frames, and `CardArt` keeps
  a frame as a pulse-free tile until its art has drawn.
- On a phone, **Days played** lists the newest seven days and opens the
  rest with Show all N days. The computer's month is unchanged.

## Battle and shared pages

- The raw battle hash at the foot of a battle page is gone.
- The notes speak plainly ("Three towers fell before time ran out"; "The
  game doesn't say whether it went to overtime") with the same facts.
- A signed-out reader sees **Join free** under the score, as well as the
  full invite lower down. The link carries only this page to come back
  to, as the invite does.

## Clan

- The head says **47 of 50 members**; Recruit and the leaders' band
  line say "3 spots open".
- The small-clan and too-few notes keep every rule (management starts
  at 10, roster and numbers until then, Recruit and Scout for elders and
  up, a saved policy picks up again at 10) in fewer words.
- Standing's note is two sentences; a leader, who reads "Leaders and
  co-leaders have no group" in their own panel, no longer reads it twice.
- Clan has no badge art (only `badge_id`), so the initials stay.

## Leftovers

- **Find › Near you** draws the player map only once its own read
  answers, so offline shows one error and one Try again.
- **Your Follow me link** is one line without `https://`, cut short where
  long, beside Copy (which copies the whole link).
- **Settings › Players & following** reads "Your players, and the players
  and clans you follow. An AI you connect uses the same spots."
- **Someone else's passport** heads the "Your circle" group "Circle".
