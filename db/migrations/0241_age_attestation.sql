-- 0241: signup's 13-or-older attestation, kept with the account it opened
-- (social slice 5, #763; 2026-11-12).
--
-- VISION.md (Jamie, 2026-11-11): "Signing up asks the person to attest
-- they are 13 or older." DECISIONS "Free public signup; collector
-- admission stays governed" says the same. Before this nothing asked.
--
-- account.age_attested_at is when the person said they are 13 or older:
-- the moment the signup form that asked was sent (frozen with the email
-- request, as the zone and the product-news box are), written only when
-- the proof opens the account. Null on every account opened before this
-- migration, and on accounts made by an admin's enrolment; nothing fills
-- them in. A person who answers no is sent nothing and nothing is stored,
-- so there is no "no" value to keep.
--
-- discord_login.signup_age_attested_at carries the same answer through a
-- Discord sign-in round trip, as signup_zone and signup_news do (0233);
-- it lives as long as the row (the jobs sweep purges it a day after).
--
-- Expand only: two nullable columns with no default, catalog-only. The
-- old code serving while this commits neither reads nor writes them.
-- account is read on every request, so the ALTER's instant ACCESS
-- EXCLUSIVE lock fails fast behind a long read rather than queue the
-- door; the deploy is retried.
set local lock_timeout = '5s';

alter table account add column age_attested_at timestamptz;

comment on column account.age_attested_at is
  '0241: when the person attested they are 13 or older, at the signup that opened this account; null for accounts opened before 0241 or by an admin.';

alter table discord_login add column signup_age_attested_at timestamptz;

comment on column discord_login.signup_age_attested_at is
  '0241: a Discord sign-in''s 13-or-older attestation, applied only if the round trip opens a new account.';
