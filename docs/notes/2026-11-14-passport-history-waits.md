# 2026-11-14 — A pre-launch account's ladder Stamps wait for its history

Follow-up to `2026-11-14-passport-backfill.md` (#1015), from the review of
PR #1025. Migration 0273.

0272 files a ladder level (Played Together, Cheerleader, Storyteller) as
legacy when the stored facts dated before launch reach it. But the
history the live paths never read (friendlies older than the
reconciliation's 30 days, highlights and cheers from before launch) only
becomes facts when the operator's `{passport_backfill}` reads it. An
account whose first post-launch friendly came before the backfill would
have been granted Played Together I as ordinary, a "New Stamp" line, for
a level an older friendly had already earned before launch; the backfill
could not refile it afterwards, since a grant is never rewritten. The
guarantee that the order between the deploy, an account's visit and the
backfill does not matter did not hold for ladders.

Now `account_passport.legacy_history_at` (0273) records when the backfill
finished an account. For an account made before launch with it null, a
ladder level that is not legacy waits: the fact is recorded, no level is
granted. The account's next earning call after the backfill grants it as
ordinary when only post-launch facts complete it, or the backfill files it
as legacy when the history reaches it. Setup Stamps do not wait. Accounts
made after launch are unaffected.

The cost: until the backfill has run, an existing account earns no
ladder Stamp. docs/OPERATIONS.md now says to run the backfill soon after
the deploy.
