-- Newsletter enrollment becomes an affirmative choice (issue #27).
--
-- Enrollment used to ride the login send: every successful sign-in
-- POSTed the address to Buttondown. Authenticating is not a marketing
-- choice, so the decision now lives on the account and defaults to off.
--
-- This column governs FUTURE enrollment only. Buttondown holds its own
-- list and its own unsubscribe state, which we have never overridden
-- and still do not; addresses enrolled under the old behaviour stay
-- subscribed there until they unsubscribe or Jamie prunes the list.
-- Whether to retro-unsubscribe them is a decision queued in NOTES.
alter table account add column newsletter_opt_in boolean not null default false;

comment on column account.newsletter_opt_in is
  'Affirmative opt-in to the product newsletter. Default false: only a
   deliberate choice on Account enrolls an address. Login and other
   transactional mail is NOT governed by this column - it is service
   mail, sent regardless.';
