-- 0008: liveness-proof claim verification (DESIGN §4.1): "change your
-- in-game favourite card to X within 15 minutes", confirmed by a live
-- profile fetch. Cheap, unspoofable enough, no Supercell cooperation.
create table verification_challenge (
  challenge_id uuid primary key default gen_random_uuid(),
  account_id   uuid not null references account,
  player_tag   text not null references player,
  card_id      bigint not null,
  card_name    text not null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  completed_at timestamptz,
  status       text not null default 'pending'
               check (status in ('pending', 'verified', 'expired'))
);
create index verification_by_claim on verification_challenge (account_id, player_tag, created_at desc);
