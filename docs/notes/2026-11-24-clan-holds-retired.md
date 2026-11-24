# 2026-11-24: Clan's hold# items retired (migration 0319)

The contract half of member exceptions
(`2026-11-23-clan-exceptions.md`). Migration 0318 copied every
`hold#<clan>#<tag>` item in `clan_state` into an
`exception#<clan>#hold-<tag without #>` item and kept the holds; the code
that shipped with it neither reads nor writes them. Jamie approved
finishing the contract on 2026-11-24.

## Migration 0319

1. **Carries over what 0318 missed.** 0318's header promised that the
   contract first copies any hold written after it (the old code served
   until the flip). Each hold with no copy yet is copied in 0318's exact
   shape, its `changed` event (for a hold with no end date) marked
   `migration: "0319"`. An exception already there wins.
2. **Deletes a hold only when its copy exists and carries it unchanged:**
   the copy's `hold` equals the item less `pk`, `gsi1pk` and `gsi1sk`.
   The exception writers spread the whole item, so a leader's later
   change or early end keeps `hold` and does not keep the hold.

Kept, never read, and gone with `deleteClan`:

- a hold with no `clan#` partition or no `player_tag` (neither migration
  can copy it; the old `putHold` always wrote both, so none should exist);
- a hold the old code rewrote after 0318 copied it.

Both could only come from the minutes between 0318's commit and the flip
on 2026-11-23, when production held two holds (1327 to 1329 items at
0318), so at most a couple and most likely none. A re-run writes nothing.

Not done: a hold the old code cleared in that window left its copy
running; it ends on its own date (at most 90 days for one that had none)
or when a leader ends it.

No schema change, so the fingerprint does not move. Tested in
`services/migrate/test/clan-holds-retired.test.mjs`. The ledger's item
list (`packages/clan-state/src/ledger.mjs`) and the DECISIONS line say
the holds are gone.
