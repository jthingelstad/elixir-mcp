-- 0005: auth plane — DESIGN §6. Secrets never stored raw: token/code
-- columns hold sha256 hex only. One credential-issuance core, two shells
-- (web magic link, OAuth authorize) — magic_login serves both via purpose.

create table magic_login (
  token_hash  text primary key,              -- sha256 of the emailed token
  email_hash  text not null,                 -- sha256(lowercased email)
  code_hash   text not null,                 -- sha256 of the 6-digit code
  purpose     text not null default 'web' check (purpose in ('web', 'oauth')),
  context     jsonb,                         -- oauth continuation state
  attempts    integer not null default 0,    -- code guesses, capped
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz                    -- link and code burn this ONE row
);
create index magic_login_by_email on magic_login (email_hash, created_at desc);

create table session (
  session_id          text primary key,      -- the sid claim
  account_id          uuid not null references account,
  created_at          timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  sliding_expires_at  timestamptz not null,  -- ~9d, re-minted on activity
  absolute_expires_at timestamptz not null,  -- hard 90d cap
  revoked_at          timestamptz            -- sign-out actually revokes
);
create index session_by_account on session (account_id);

create table rate_limit (
  bucket       text not null,
  window_start timestamptz not null,
  count        integer not null default 0,
  primary key (bucket, window_start)
);

-- OAuth 2.1 (public clients, PKCE S256, opaque hashed tokens).
create table oauth_client (
  client_id     text primary key,
  client_name   text,
  redirect_uris jsonb not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,        -- registration TTL, refreshed on use
  last_used_at  timestamptz
);

create table oauth_code (
  code_hash      text primary key,
  client_id      text not null references oauth_client,
  account_id     uuid not null references account,
  code_challenge text not null,              -- PKCE S256 challenge
  redirect_uri   text not null,
  scope          text,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,       -- 5 minutes
  used_at        timestamptz
);

-- Refresh rotation with family-replay revocation (RFC 9700 §4.14.2):
-- the family row carries the 90-day absolute lifetime and the revocation
-- switch that kills every descendant at once.
create table oauth_family (
  family_id           uuid primary key default gen_random_uuid(),
  client_id           text not null references oauth_client,
  account_id          uuid not null references account,
  created_at          timestamptz not null default now(),
  absolute_expires_at timestamptz not null,  -- forces re-consent (§6.2)
  revoked_at          timestamptz
);

create table oauth_token (
  token_hash  text primary key,
  kind        text not null check (kind in ('access', 'refresh')),
  family_id   uuid not null references oauth_family,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,          -- access 1h, refresh 30d
  rotated_to  text,                          -- successor's hash; set once
  revoked_at  timestamptz
);
create index oauth_token_by_family on oauth_token (family_id);

-- Per-call MCP audit rows — operational telemetry, short retention; the
-- tuning loop's evidence (§11.3). Never load-bearing for serving.
create table mcp_call_audit (
  audit_id    bigint generated always as identity primary key,
  account_id  uuid references account,
  surface     text not null default 'mcp',
  tool        text not null,
  args        jsonb,                         -- bounded at write
  duration_ms integer,
  result_bytes integer,
  truncated   boolean not null default false,
  error_code  text,
  created_at  timestamptz not null default now()
);
create index mcp_call_audit_by_time on mcp_call_audit (created_at desc);
