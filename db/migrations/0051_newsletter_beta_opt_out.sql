-- The newsletter is opt-OUT for the beta (Jamie, 2026-09-07).
--
-- 0049 made it opt-in, default false. That was the wrong reading of the
-- product: this is a private, individually approved beta, and taking
-- part in it includes the product emails. You can unsubscribe from any
-- issue afterwards; you cannot be in the beta and refuse to hear from
-- it. Stated plainly on the privacy page rather than implied.
--
-- The column stays. It is the seam the relay reads, so per-user control
-- later is a UI change instead of another migration - but nothing in
-- the app sets it today, and no control claims to.
alter table account alter column newsletter_opt_in set default true;
update account set newsletter_opt_in = true where newsletter_opt_in is not true;

comment on column account.newsletter_opt_in is
  'Whether a login send also enrolls this address in the product
   newsletter. Default TRUE: beta participation includes the emails.
   Unsubscribing happens at Buttondown, through the link in every
   issue, and is never overridden - an address that already exists
   there is left exactly as it is, unsubscribed or not.';
