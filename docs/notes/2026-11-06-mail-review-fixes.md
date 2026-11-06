# 2026-11-06 — Mail: two review findings on step 8

Codex's findings on #691, both before the mail deployed.

- **"was removed" needs a verified claim.** `memberClans` counted any primary
  or alt claim, so claiming a member's tag and tracking the clan was enough to
  read a clan-visible fact. `readerDoors` now also answers `verifiedClans` with
  the check `factItems` makes, and the render says "was removed" only for
  those clans; anyone else reads "departed". `memberClans` still picks links,
  because the page behind a link makes its own check.
- **Gone quiet's date stops at the week's close.** `lastBattlesOf` takes the
  cutoff `buildClanEntry` judges quiet by (`toMs + 1`), so a battle after the
  close cannot show beside a member the report calls quiet. A member with no
  battle before the cutoff has no date, and the render draws no line for them.

Open, for Jamie: Gone quiet's names and dates still follow `memberClans`, so an
unverified claim reads them (a product call: the ruling says members and does not say verified).
