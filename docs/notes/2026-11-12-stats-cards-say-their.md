# 2026-11-12 — A followed player's Cards says "their"

Follow-up to `2026-11-12-stats-for-players-you-follow.md` (PR #833), from
Codex's review there: Cards never read `ladder/whose.js`, so a followed
player's Cards still said "Your cards", "Your record" and "Across the
table from you", putting their numbers in the reader's name.

Cards now takes its words from `useWhose()` like Season, Decks, Battles
and Form: **Their cards**, **Their record**, **Across the table from
them**, and the faced card's column reads **Opponent's card** (two
"their"s in one row would not say whose). The level-gap line
(`gapLine` in `ladder-decks.js`, on Decks' rows and Season's top deck)
reads "their cards 0.60 levels above their opponents'" for a followed
player. Own pages read as before. Pinned by an e2e in
`apps/web/e2e/ladder.spec.ts` (Ladder cards) and `test/ladder-decks.test.js`.
