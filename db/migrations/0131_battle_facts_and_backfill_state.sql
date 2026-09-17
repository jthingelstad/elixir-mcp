-- 0131: the battle's own facts the log carries and the row never kept
-- (time-series review 2.4, 4.4), and the series backfill's cursor.
-- Nullable columns on battle (250k rows: instant, no default); their
-- fill from the battlelog receipts is the Phase 2 keyset op, never a
-- migration (the 0099 lesson).
alter table battle
  add column arena_id              integer,
  add column event_tag             text,
  add column tournament_tag        text,
  add column deck_selection        text,
  add column is_ladder_tournament  boolean,
  add column is_hosted_match       boolean,
  add column boat_battle_side      text,
  add column new_towers_destroyed  smallint,
  add column prev_towers_destroyed smallint,
  add column remaining_towers      smallint;
comment on column battle.event_tag is
  'The API''s eventTag; joins game_event without a key on purpose (a battle can name an event the daily /events read never sighted).';

-- One row per backfill lane ({series_backfill}, review Part 5): the
-- receipt cursor, so the op is keyset-resumable across invocations.
create table series_backfill_state (
  lane             text primary key check (lane in ('clan', 'player', 'battle')),
  after_receipt_id bigint not null default 0,
  receipts_done    bigint not null default 0,
  rows_written     bigint not null default 0,
  started_at       timestamptz,
  finished_at      timestamptz,
  updated_at       timestamptz not null default now()
);
comment on table series_backfill_state is
  'Cursor per backfill lane: the last api_receipt.receipt_id the lane has projected, and its tallies. finished_at set when the lane ran out of receipts.';

-- The shape census (review 2.7) files into feedback under the owner
-- account as its own surface.
alter table feedback drop constraint feedback_surface_check;
alter table feedback add constraint feedback_surface_check
  check (surface in ('web', 'mcp', 'recorder'));
