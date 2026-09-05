-- The push lane (Jamie, 2026-09-05): a per-account event feed agents
-- read with elixir_events. Subscriptions are IMPLICIT - your claims,
-- recordings, and feedback ARE your subscriptions; the feed fans out
-- on write (accounts are few, watches are bounded). Topics v1:
-- battles_recorded, feedback_responded, recording_started,
-- recording_stopped, role_changed, clan_war_week_finished.

create table event_feed (
  event_id    bigint generated always as identity primary key,
  account_id  uuid not null references account on delete cascade,
  topic       text not null,
  subject_tag text,
  payload     jsonb,
  created_at  timestamptz not null default now()
);

create index event_feed_account_cursor on event_feed (account_id, event_id);

-- Cheap "anything new?" hint for response meta without a table scan.
alter table account add column events_seen_through bigint not null default 0;

-- The feed is operational, not archival: the sweep prunes rows older
-- than 30 days (see sweep_operational).
