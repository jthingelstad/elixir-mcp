# 2026-11-26 — The stored build's first day: two differences, both closed

A day of `TimelineStoryBuild=shadow`
(`2026-11-25-timeline-story-build.md`) compared 183 Home weeks built
both ways. No story was missing from either build, none came at another
revision, and the order always agreed. Fifteen `battle_session` items
differed in content with the cause `settled`, the one the note said the
next stage must explain. They were two things.

## Tied modes read in another order (12 of 15, two sittings)

A sitting's sentence lists its modes by count: "2 Trophy Road, 2
Ranked". Two modes with one count kept the order of the keys in
`facts.by_mode`. A build makes that object in the order the modes were
played; a stored row gives it back in jsonb's own key order. `facts`
compared equal (the comparison is canonical), and `text`, which every
read writes from the facts, did not. Two sittings with a tie differed in
every build that held them.

`modes` in `packages/tools/src/activity/summary.mjs` now breaks a tie by
a fixed order (the mode words table's, then by name), so a sitting reads
the same from a build and from a row. A tied sitting whose modes were
played in another order than the table's changes its sentence once. No
stored row changes: a row holds no `text`. Clan's own telling of a
sitting (`packages/clan-engine/src/stories.mjs`) had the same tie and
now breaks it by name.

## "Still going" served a minute late (3 of 15)

A build calls a sitting open while its last battle is under 30 minutes
old. The read of a stored row refused a row that said `open` only once
that battle was more than 31 minutes old, so for one minute the row
served "still going" where a build no longer said it. The read now
refuses from 30 minutes, exactly where a build closes the sitting. The
sweep still waits the 31st minute before it looks for a quiet open
sitting to rewrite; until it has, that player is computed.

## What is next

`TimelineStoryBuild` stays at `shadow` until builds after this change
show both gone, then goes to `on`. The player page's shadow
(`TimelineStoryShadow`) has matched on every page served from rows since
2026-11-25 and goes to `off` with it.

No migration, no contract change, no new parameter.
