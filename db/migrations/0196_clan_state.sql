-- 0196: private Clan state moves into Elixir's storage (Jamie, 2026-10-02).
-- Additive foundation only: the legacy runtime still owns its Dynamo items.
-- Stable item keys and complete JSON preserve versions, action IDs, private
-- notes, watermarks and sealed model keys. No sessions or OAuth pairs are
-- copied. A reviewed, digest-bound import follows through the migrate op.
-- No canonical game tables change. This creates only new, empty relations.
create table clan_state (
  pk text primary key,
  body jsonb not null,
  partition_key text generated always as (body ->> 'gsi1pk') stored,
  sort_key text generated always as (body ->> 'gsi1sk') stored,
  updated_at timestamptz not null default now(),
  constraint clan_state_object check (jsonb_typeof(body) = 'object'),
  constraint clan_state_key check (body ->> 'pk' is not null and body ->> 'pk' = pk),
  constraint clan_state_not_session check (split_part(pk, '#', 1) not in ('session', 'login'))
);
create index clan_state_partition on clan_state (partition_key, sort_key collate "C");
comment on table clan_state is 'Private Clan ledger (0196), never a game fact or a public MCP surface. Complete legacy items retain stable keys and sealed model boxes. Temporary logins and sessions are excluded.';
comment on column clan_state.body is 'Lossless item object including pk; keys outside a listing partition (notably sealed model keys and preferences) remain outside it.';
create table clan_state_import (
  snapshot_sha256 text primary key,
  item_count integer not null,
  kinds jsonb not null,
  imported_at timestamptz not null default now()
);
comment on table clan_state_import is 'Digest and counts of the privately staged Clan snapshot imported once (0196). No private bodies or account tokens in receipts.';
