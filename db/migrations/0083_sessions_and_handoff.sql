-- 0083: the sign-in review of 2026-09-12.
--
-- session: what the Profile page's device list shows. A short client
-- label derived from the user agent (never the raw string), and where
-- the session was last seen from. Written in the same UPDATE that slides
-- the expiry, so they cost a request nothing.
alter table session add column client text;
alter table session add column last_seen_from text;
alter table session add column last_seen_country text;

-- magic_login: the cross-context handoff. A sign-in started in one
-- browser (a desktop tab, an installed app) whose link is opened in
-- another (the phone's mail app) can hand the session back to the one
-- that asked. poll_id_hash is the secret the asking browser holds;
-- started_from is where it asked from; handoff_state is none until the
-- link is redeemed, ready once the redeeming side allows it (at once
-- from the same address, after a confirmation from a different one),
-- taken once the asking browser has collected its session.
alter table magic_login add column poll_id_hash text;
alter table magic_login add column started_from jsonb;
alter table magic_login add column handoff_state text not null default 'none'
  check (handoff_state in ('none', 'confirm', 'ready', 'taken'));
alter table magic_login add column handoff_confirm_hash text;
create index magic_login_by_poll on magic_login (poll_id_hash) where poll_id_hash is not null;
