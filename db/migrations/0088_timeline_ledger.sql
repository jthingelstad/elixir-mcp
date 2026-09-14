-- The timeline (review 2026-09-13 Part IV): the per-subject ledger
-- (player_event, clan_event, 0001) carries every named moment from ingest
-- onward, and the timeline is read from it. The per-account event_feed
-- (0030), fanned out and coalesced at write time, is retired with its
-- cursor; the activity bookmark (0087) is the read pointer now.
drop table if exists event_feed;
alter table account drop column if exists events_seen_through;

-- Arena ids are opaque (54000144 is "Spirit Square"); the profile payload
-- is the only place the name travels, so the snapshot projector keeps a
-- catalog and the timeline names arena moves from it.
create table arena (
  arena_id      integer primary key,
  name          text not null,
  first_seen_at timestamptz not null default now(),
  observed_at   timestamptz not null default now()
);

create index if not exists player_event_window on player_event (player_tag, window_end desc);
create index if not exists clan_event_window on clan_event (clan_tag, window_end desc);
