# 2026-11-13 — Bites carry invented players and clans

The second step after `2026-11-13-anonymize-fixtures.md`: the captured
bites whose case names no real player (74 of the 140 such files held real
tags or names) now carry invented players and clans from the same mapping.
`bites.test.mjs` still proves every one fails its case with the same
message. The 48 bites whose gym case names a real player move with the
gym in the next change, since their captured arguments must match it.

The anonymizer also:

- takes a keyed tag of up to 12 characters, the normalizer's limit (it
  stopped at 10);
- invents for every real tag in one fixed order, so a short tag's
  invention never depends on which files a run covers;
- keeps arena, league and mode names as the game's words.

A newly fetched bite is anonymized before it is committed
(`acceptance/README.md`). Nothing a person sees changes; nothing to deploy.
