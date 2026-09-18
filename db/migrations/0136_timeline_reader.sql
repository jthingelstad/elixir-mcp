-- 0136: named timeline readers (interface review 2026-09-19, product
-- call 4; contract 3.18.0). An account's read pointer was one column
-- (account.activity_seen_at, 0087), so two consumers on one account
-- moved each other's window and the three Discord agents never marked
-- at all, which left meta.timeline_pending counting since epoch for
-- them. A reader is a short name a consumer picks for itself; its
-- pointer moves only when that reader marks. The account column stays
-- as the unnamed pointer (a person's own client). Additive; nullable
-- nowhere because a row exists only once a reader has marked.
create table timeline_reader (
  account_id  uuid not null references account on delete cascade,
  reader      text not null check (reader ~ '^[a-z0-9][a-z0-9-]{0,31}$'),
  read_to     timestamptz not null,
  updated_at  timestamptz not null default now(),
  primary key (account_id, reader)
);

comment on table timeline_reader is
  'A named consumer''s elixir_timeline read pointer (reader argument, 3.18.0): moved only by that reader''s mark_read. meta.timeline_pending counts against the oldest named pointer when any exists, else account.activity_seen_at.';
