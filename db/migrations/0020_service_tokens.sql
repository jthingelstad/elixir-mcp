-- 0020: service tokens (Jamie, 2026-09-04) — the elixir-bot lane.
-- Long-lived, Admin-issued, bound to an account; stored as sha256 only.
-- Calls audit with surface 'svc:<name>' for per-token visibility.
create table service_token (
  token_id    bigint generated always as identity primary key,
  account_id  uuid not null references account,
  name        text not null unique,
  token_hash  text not null unique,
  created_at  timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at  timestamptz
);
