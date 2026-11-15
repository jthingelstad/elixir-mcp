# 2026-11-14 — A place belongs to the claim that wrote it

A privacy fix, from the hand-back of #1054 and #1055 and the open item in
`2026-11-14-player-map-and-near-you.md`.

## The defect

A person's place is stored in Clan's ledger under each of their verified
tags (`place#<tag>` rows in `clan_state`). When a tag's verified claim
moved to another account (the owner removed the player, and someone else
added and verified it), the row stayed. The new owner was then shown the
former owner's place in Settings › Profile › Your place and as the
picker's starting point, the clan map showed it under the tag, Near you
searched around it for the new owner, and the passport counted it as the
new owner's place. The player map, and Near you's list of other people,
already required the place to be written after the current claim was
verified; the owner's own view, the clan map, Near you's own place and
the passport did not.

## The rule

A place belongs to the claim that wrote it. One predicate,
`placeOwnedBy` in `@elixir-mcp/auth/clan-context`, says when a row is a
place for the verified own claim (primary or alt) it is read under:

- **Stamped:** every save since this change writes `account_id`, the
  saver's account, on each row. A stamped row counts only when the stamp
  equals the claim's account.
- **Unstamped** (every row saved before this change): it counts only when
  written at or after the claim was verified (`set_at >= verified_at`), or
  when the claim has no verification time (claims verified before that
  column, which predate places). Verifying a tag always sets `verified_at`,
  so a row left by a former owner is always older than the new claim.

A row that fails is no place, for every reader. There is no other read of
place rows:

- `readOwnedPlaces(db, tags)`, new in the seam: one statement, each tag
  read by its key in the list's order (`unnest ... with ordinality`, never
  `player_tag = any($1)`), through the tag's verified own claim and the
  predicate. Clan's social service takes it as `ownedPlaces` (Your place,
  the picker, setting and leaving the player map, the clan map); the
  passport's "has a place" and the Stamps legacy check read through it.
- The player map and Near you use the same predicate inside their own
  statements; Near you's own place (the reader's) now uses it too.
- The ledger's raw `places(tags)` read is gone, so nothing can read a
  place around the rule. `clan-boundary.test.mjs` pins the callers of
  `readOwnedPlaces` and that no other code reads place rows by key.

The stamp never leaves the seam: `readOwnedPlaces` drops it with the
ledger keys, and no answer carries an account.

## Why this mechanism

- **Stamp plus timestamp, read side.** The stamp makes ownership exact
  for new rows (it also closes a race the timestamp alone cannot: a save
  whose gate was read just before the tag moved, written just after). The
  timestamp covers the rows already stored, with no production write, the
  same derivation the map readers already used. Together they let a
  former owner who verifies the tag again get back a place only when it
  is a stamped row they wrote; an unstamped row from before a
  re-verification stays hidden, the safe direction.
- **Not clearing on the claim's end.** Deleting the row when a claim ends
  would make `packages/claims` write Clan's private ledger inside Verify's
  and Remove's transactions, and it would still leave every row already
  stored behind a moved tag. The read rule covers both; an orphaned row
  is inert and is overwritten by the next owner's first save, or removed
  by its owner's Remove while they still hold the tag.
- **No migration.** Existing rows are handled by the timestamp rule, so
  this change writes nothing in production and needs no backfill.

## Tests

`services/web-api/test/place-owner.test.mjs`, on a scratch database,
through Clan's social service over the real ledger and the real claim
move (`removePlayer`, then `markVerified`): after a tag moves from A to B,
B's Your place is empty, the clan map shows nothing for the tag, the
player map and Near you show nothing for it, and B's Near you has no
place; B sets a place and the clan map shows it as B's, the player map
only after B joins it; A never sees B's place; A verifying the tag again
gets nothing from B's row, and gets back a row A wrote; an unstamped row
counts only for a claim verified before it was saved; the read is one
statement, by key. Query budgets are unchanged: the clan map, Your place
and the passport each read places in one statement, as before
(`signed-in-budget.test.mjs` pins the map's one read).

No contract bump: these are app routes, not MCP or `/api/v1`. No
migration. A deploy ships it; nothing is owed after.
