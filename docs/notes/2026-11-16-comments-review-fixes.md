# 2026-11-16 — Comments: three fixes from Codex's review of #1078

All three were behind `CommentsEnabled`, which is still off, so nobody
was affected.

- **Blocked cheers.** Two block filters on cheers passed an unqualified
  `account_id` to `blockedSql`. Inside its subquery that name means
  `account_block.account_id`, so the filter got both directions wrong:
  - a block someone held against you hid every cheer on your play
  - a block you held still let the blocked person's cheers through
  The two filters are the bell's reactions (the bell, the activity mail
  and push) and `cheersReceived`. Both now alias `timeline_cheer tc`, and
  `blockedSql`'s comment says a column must be qualified. A test pins
  that the blocked person's cheer is left out and another person's is
  counted.
- **Parallel posts.** The limits count logged checks, and a check is
  logged only once the model answers. Parallel posts could therefore
  all pass the count, and the same words could post twice. A post now
  holds a per-account session advisory lock (`pg_try_advisory_lock`)
  from the limit check to the insert. A second post while one is being
  checked answers 429 `rate_limited`: "Your last comment is still being
  checked."
- **Reports.** A report now needs the comment to be visible and its item
  to be in the reporter's own feed, as listing and posting already do.
  Comment ids are sequential, so before this two unrelated accounts
  could hide comments they had never been shown.
