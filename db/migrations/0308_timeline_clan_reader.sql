-- A home-clan consumer has a separate position even if it also reads
-- the all-followed feed under the same reader name.
create table timeline_clan_reader (
  account_id uuid not null references account on delete cascade,
  clan_tag text not null references clan (clan_tag) on delete cascade,
  reader text not null check (reader = '' or reader ~ '^[a-z0-9][a-z0-9-]{0,31}$'),
  read_to timestamptz not null,
  primary key (account_id, clan_tag, reader)
);
