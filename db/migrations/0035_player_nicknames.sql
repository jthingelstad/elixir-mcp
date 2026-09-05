-- Per-account player nicknames (Jamie, 2026-09-06: "To me Raquaza is
-- Tyler, and King Levy is Levi... just for my user"). Strictly ACCOUNT
-- data: scoped to the owning account in every read, never public,
-- never cross-account - a nickname is how YOU know someone, not a fact
-- about them.
create table player_nickname (
  account_id uuid not null references account on delete cascade,
  player_tag text not null,
  nickname   text not null check (length(nickname) between 1 and 40),
  created_at timestamptz not null default now(),
  primary key (account_id, player_tag)
);
