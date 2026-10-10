# 2026-10-10 — Verification reads and first reads keep their bounds

Two free live reads, charged to nobody's live quota, could be repeated past
their bounds by removing and adding a player (Codex review of #136 and #371).

- **Verification reads per tag.** `liveReadsSpent` summed
  `claim_challenge.live_reads`, and a challenge row is deleted with its claim
  (0080, `on delete cascade`). Removing the player and adding it back reset
  the tag's 120-a-day ceiling. The reads are now counted in their own ledger,
  `rate_limit` rows keyed `verify-read#<tag>` per clock hour (kept a week),
  which a claim's deletion does not touch; the ceiling reads the current
  clock hour and the 23 before it. `claim_challenge.live_reads` stays as the
  challenge's own count. The ledger starts empty at deploy, so each tag's
  ceiling starts afresh once.
- **First reads per person.** Every add of a tag not read in the last day
  minted one live read from the global bucket, so an account could add,
  remove and add fresh tags to drain it. `requestFirstRead` now takes the
  adding account and spends `firstread#<pool owner>` (UTC date, like
  `liveday#`) in `beforeMint`, so only a minted job counts and a refused one
  gives its token back. The allowance is the pool's player-slot ceiling per
  day (`poolLimits`), shared by a person and their agents; owner and admin
  are exempt. Past it the add still succeeds with `first_read: false` and
  the scheduler's first read comes as for any new recording.

No migration and no contract change: the response shapes are unchanged.
Public docs: `limits.md` (both rows), `recording.md`, `verify.md`.
