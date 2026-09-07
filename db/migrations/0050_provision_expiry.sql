-- Staged collector credentials expire (issue #31).
--
-- provision_token mints a bearer, stores its hash, and stages the RAW
-- token in gateway.provision_env for the operator's one-time reveal.
-- The post-claim design is sound - hash only, nulled on read - but the
-- PRE-claim window had no end: a token staged and never claimed sat in
-- the database as plaintext indefinitely, and anyone who could read
-- the row had an unused live credential.
--
-- The window is now explicit. A staged secret that is never claimed
-- stops being claimable, and the weekly operational sweep clears it.
alter table gateway add column provision_expires_at timestamptz;

-- Anything staged right now gets the same clock rather than an
-- exemption: a NULL here reads as EXPIRED at the claim door (the
-- predicate is `provision_expires_at > now()`, which NULL fails), so
-- grandfathering by leaving it NULL would silently break a pending
-- handover instead of protecting it.
update gateway set provision_expires_at = now() + interval '72 hours'
where provision_env is not null;

comment on column gateway.provision_expires_at is
  'When a staged provision_env stops being claimable. Set at staging;
   the claim requires it to be in the future, so NULL means expired.
   Cleared with the secret when the sweep prunes it.';
