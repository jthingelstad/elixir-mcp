# 2026-11-13 — The clan directory's read budget

Social slice 10, first half (#768): the clan directory was built on
2026-11-12 (`2026-11-12-clan-directory.md`, `/clan/directory`). This change
does not rebuild it. It measures the one read behind the grid and closes
what that measurement found, and fixes Find's line about it.

## What was measured

`services/migrate/test/clan-directory-plan.test.mjs` fills a scratch
database with thirty thousand Clan ledger rows that are not policy
pointers, twenty thousand recorded clans with a week of the clan series
each, sixty clans with a saved policy and a year of their series, and five
thousand other people's claims and memberships. It asserts on query count
and plan shape, never on milliseconds:

- One statement for a reader with a listed clan; two when nothing comes
  back (the read, then whether the reader may read), as before.
- No Seq Scan on `clan_state`, `clan`, `clan_snapshot_daily`, `claim` or
  `clan_membership`; the ledger is entered through
  `clan_state_policy_pointer`; the series is read once per listed clan at
  most, a few rows each.

Before this change the plan was a Seq Scan of the whole Clan ledger
(`clan_state`): the reader's pattern `^policy##<tag>$` could not range over
the primary key, which is in the database's collation, and the pointer
carries no listing partition. Every Action, verdict and schedule body was
read to find a few dozen pointers.

## What changed

- Migration 0260 adds `clan_state_policy_pointer`, a partial index on
  `clan_state (pk)` whose predicate is the reader's own pattern word for
  word, so the planner matches it. It holds one row per clan that saved a
  policy.
- `readClanDirectory` reads the reader's own current clans once, as a set
  (`mine`), instead of an `exists` per listed clan. Same answer
  (`clan-directory.test.mjs` unchanged and passing).
- A hostile-name test: a clan name and description holding markup render
  as text in the tile, and search finds them as text
  (`apps/web/test/clan/directory.test.jsx`).
- Find's Clan directory row said "Every clan on Elixir, with its open
  spots", which was not true: it lists only clans with a saved policy, and
  "open spots" is a filter, not the list. It now says "Clans that saved
  their rules in Elixir, by name. Never ranked."

## Kept as it was

- Not paged. The grid is one bounded read of up to 500 clans by name, and
  the filters run in the browser over it so that a filter hides and never
  reorders (`[engineering, 2026-11-12]`). At dozens to hundreds of clans
  that is the simplest correct read; paging would move every filter to
  the server and is worth doing only when the bound is near.
- Search covers name, tag and in-game description; the policy's public
  part is searched through the filters, since a saved policy holds no
  public free text (the note and the Recruit pitch stay private).
- The page stays at `/clan/directory`; Find links to it.

## Versions

Migration 0260. MCP and JSON API unchanged.
