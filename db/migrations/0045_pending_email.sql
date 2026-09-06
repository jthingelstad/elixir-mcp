-- Deliver the email the request page promises.
--
-- "If your request is approved, you'll hear from us by email." Nothing
-- could: the account table keeps only sha256(lowercased email), so at
-- approval time the system does not know the address it promised to
-- write to. The approval hook emailed the OWNER instead, which is why
-- an approved applicant heard nothing at all.
--
-- Minimum retention that keeps the promise: hold the address from the
-- request until the decision, and clear it the moment the decision mail
-- is queued. An approved account still stores no address, which is the
-- property the hash was protecting.
alter table account add column pending_email text;

comment on column account.pending_email is
  'The applicant''s address, held ONLY between requesting access and being decided, so the approval email can be sent. Cleared when the decision is made. Never populated for an account that has already been decided.';
