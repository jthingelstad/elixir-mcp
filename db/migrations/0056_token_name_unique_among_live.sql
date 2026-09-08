-- Rotating an agent's key collided with the key it had just revoked.
--
-- 0053 scoped token names per account: `unique (account_id, name)`. That is
-- the right scope, but it counts REVOKED rows, and a rotation is exactly
-- "revoke the old one, issue a new one with the same name" -- so the insert
-- hit the constraint against a row that no longer authenticates anything.
--
-- A name identifies a live credential. A revoked token is history and should
-- not hold a name hostage, so the uniqueness moves to a partial index over
-- live rows only. Existing data cannot violate it: it is strictly weaker than
-- the constraint it replaces.
alter table service_token drop constraint service_token_name_per_account;

create unique index service_token_live_name_per_account
  on service_token (account_id, name)
  where revoked_at is null;

comment on index service_token_live_name_per_account is
  'A token name is unique among an account''s LIVE tokens. Revoked tokens keep their name as history and never block reissuing it.';
