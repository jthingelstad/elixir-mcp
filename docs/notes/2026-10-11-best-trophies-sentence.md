# 2026-10-11 — A new best is told as it happened (11.11.2)

MCP 11.11.2. JSON API 3.2.0 unchanged. No migration.

- **The defect:** live in POAP KINGS, "I Hate Witch set a new best of
  12,032 trophies, crossing 12,000, on a 3-0 win over keyluis (11,943),
  +26 to 12,005." `facts.best` is the profile's best when the record saw
  it (20:22Z), which was after, and higher than, the battle that crossed
  the rung (19:03Z, to 12,005). The sentence put the two side by side as
  if the battle set the best.
- **The fix:** `itemText` (`packages/tools/src/activity/summary.mjs`).
  When `best` is above `crossed_by.trophies_after`, the item tells the
  crossing, then the peak: "passed 12,000 trophies for the first time,
  on a 3-0 win over keyluis (11,943), +26 to 12,005, and went on to a
  best of 12,032." A band item exists only when the earlier best was
  below the band, so "for the first time" is the record's. When the
  crossing set the best itself, the sentence is as before; a best read
  below where the crossing ended is a stale read, and the crossing alone
  is told. Facts, `follow` and `at` are unchanged.
- **The same battle told twice:** the battle also moved I Hate Witch to
  Magic Academy, told an hour earlier as an `arena_changed` item on the
  same `promoted_by` battle. Both stay. They are two records, an arena
  floor and a personal best, that coincide here but not in general (an
  arena regained after a drop is no new best), each with its own facts,
  kind filter, evidence and story id, learned from different reads
  (20:17Z and 20:22Z). Folding one into the other would change what a
  `kinds` reader receives, which is not a correction. Each now reads
  truthfully on its own.
