# 2026-11-11 — Building the social layer: the plan

Jamie approved the split on 2026-11-11: "split #752 into slice issues with
the gate and slots first, and write the build plan note". The design is the
social design canvas (rounds 1 to 3, the same day). #752 stays the
tracker; each slice is an issue.

## Order

| # | Slice | Issue | Before it starts |
| --- | --- | --- | --- |
| 1 | Everyone signs in | #759 | measure signed-out reads by route |
| 2 | Follow slots, counted by what you cause Elixir to record | #760 | measure cost per recorded player; Jamie: the limit's behaviour |
| 3 | The flat kit | #761 | |
| 4 | Highlight to your timeline, then share it | #762 | |
| 5 | Joining from a link | #763 | |
| 6 | The player page and following | #764 | Jamie: "One name, one door" and mail links |
| 7 | One feed, sessions with sparklines, reactions, RSS | #765 | Jamie: Home's tabs and the shell; the reaction set |
| 8 | Clan as one view | #766 | Jamie: Clan's tabs (A3) |
| 9 | The digest, and posts in a clan's Discord | #767 | Jamie: the digest replacing the friends mail; cadence |
| 10 | The clan directory, and players near you | #768 | a legal view, before Near you |
| 11 | What members see | #769 | |

## Why this order

- **The gate and slots come first** because Jamie named them as what must
  be built in at the beginning, and every later surface depends on them:
  who can read it, and what a follow costs. Closing anonymous reads also
  cuts cost before anything new adds load.
- **The flat kit comes before new screens**, so they are built flat once
  rather than redone.
- **Highlight and join** are the first thing a new person meets, and the
  one door that stays open: a shared post or a sent battle link.
- **The rest follow the canvas's order.** Slices 6 to 10 each wait on a
  ruling the canvas would reverse, quoted in its design note; asking
  before the slice starts, not mid-build, keeps a build from stalling.

## How each slice runs

- One slice, one session (`scripts/session-start`), its own pull requests.
  It reads the slice's issue, the canvas board it names and the product
  brief for the surface, and writes a design note listing its product
  questions with the brief's answer.
- It starts on Jamie's go for that slice. Defaults taken mid-build are
  tagged `[engineering, date]` and listed in the pull request.
- Done is deployed and verified with one real read; Codex's findings are
  read and answered before the session finishes.
