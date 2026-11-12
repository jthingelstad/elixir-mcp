-- 0242: the digest's cadence, kept with its switch (social slice 9,
-- #767; 2026-11-12).
--
-- The digest of the people you follow replaces the friends mail and
-- keeps its kind, `tracking_report`, so every switch already turned off
-- stays off and every old one-click link still works. Jamie, 2026-11-12,
-- asked "Slice 9, the digest: should a digest of the people you follow
-- replace the friends (tracking) mail, so there are still seven mail
-- kinds? And what cadence?", answered "Weekly default (Recommended)":
-- "Replaces friends mail. Weekly by default, daily or off by choice,
-- never an empty week."
--
-- account_email_pref.cadence is the person's choice of how often: null
-- is the default (weekly), 'weekly' or 'daily' once they choose. Off
-- stays `enabled = false`, so the switch and the cadence are two
-- columns of one row and a turn-off never forgets the cadence.
--
-- Expand only: a nullable column with no default (catalog-only), and a
-- CHECK added NOT VALID. Every existing row's cadence is null, which the
-- check accepts, so no VALIDATE is needed for it to hold; new writes are
-- checked from this commit. The old code serving while this commits
-- neither reads nor writes the column, and its upsert names only the
-- columns it sets. The table is small (a row only where a person changed
-- a default) but read by every mail run, so the ALTER fails fast behind
-- a long read rather than queue it; the deploy is retried.
set local lock_timeout = '5s';

alter table account_email_pref add column cadence text;

alter table account_email_pref
  add constraint account_email_pref_cadence_check
  check (cadence is null or cadence in ('weekly', 'daily')) not valid;

comment on column account_email_pref.cadence is
  '0242: how often a kind with a cadence comes (the digest, tracking_report): null is weekly, the default; weekly or daily once chosen. Off is enabled = false.';
