-- Keep the user's email address (Jamie, 2026-09-06: "I definitely think
-- we should be. It is worth keeping. We do it for Drop already.")
--
-- 0045 held the address only from request to decision, which was the
-- narrowest thing that could deliver the approval mail the request page
-- promises. The decision is to keep it outright, the way Elixir Drop
-- keeps it on a player profile: an account we can never write to is an
-- account we can never tell anything.
--
-- email_hash stays the identity and the unique key. This column is the
-- contact address, and it is not what anything looks an account up by.
alter table account add column email text;

update account set email = pending_email where pending_email is not null;
alter table account drop column pending_email;

comment on column account.email is
  'The account holder''s address, for transactional mail we send them. Recorded at access request and refreshed at sign-in, so accounts predating this fill in as people return. email_hash remains the identity and the lookup key; never resolve an account by this column, and never expose it on a public surface.';
