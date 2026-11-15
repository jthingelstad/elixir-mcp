# 2026-11-14 — Tag-footprint census counts clan-tracked opponents; three small fixes (#452, #446)

## #452: `with_tracked_other_side`

The ops tag-footprint census (`services/migrate/src/ops-diagnostics.mjs`)
counts, per footprint player, whether someone on the other side of their
battles is tracked. Its test named a recorded player and a claimed or
followed player, but not a player held by an open membership in a
recorded or followed clan, which `tracked_clan_memberships` in the same
census already counts for the audited tag. An opponent tracked only through their clan read
as untracked, so the census overstated how much of the footprint was
reached by no one.

- One `trackedClan(tag)` fragment (an active `recording` of the clan, or
  an `account_clan` follow) now serves both `tracked_clan_memberships`
  and the other-side test, which adds an open `clan_membership` of the
  opponent in such a clan.
- `services/migrate/test/tag-footprint.test.mjs` gives one audited tag
  four battles whose opponents are an open member of a recorded clan, an
  open member of a followed clan, a former member of the recorded clan
  and an untracked player; it expects 2 of 4 and fails on the old SQL.

## #446: the small items

- `.claude/settings.local.json` is in `.gitignore` (personal permission
  grants, never shared).
- `services/migrate/src/ops-participation-plan.mjs` reads `clan_tag`
  through contracts' `normalizeTag` instead of its own regex, so it folds
  case, a missing `#` and the letter O like every other door and refuses
  a missing or non-string tag as `clan_tag_required`. Pinned in
  `services/migrate/test/participation-plan-only.test.mjs`.
- `apps/web/src/components/ZoneOffer.jsx` named the zone with `new Date()`
  in render; it now takes `now` from `useClock()` (the visit's instant,
  read once), so render is pure.
- The gym `91.3` item had already gone from main.
