-- 0185: the Elixir family's own OAuth clients, provisioned, not registered.
--
-- A first-party client (unmetered on /api/v1, an uncapped live lane,
-- and the only kind that may ask for account:email or clans:attest)
-- now needs a row here, which only this migration and the family_clients
-- migrate op write, as well as every redirect URI on a family origin
-- (review §6.5).
--
-- Each family app exchanges its codes on its own server, so each is a
-- confidential client: secret_hash is the sha256 hex of the secret it
-- sends as client_secret at /oauth/token (never the secret; the op is
-- handed only the digest). While secret_required is false a presented
-- secret is checked and a missing one is allowed; last_authenticated_at
-- says the app is sending it, and then the op sets secret_required, from
-- which a token request without it is refused.
--
-- Seeded with the client ids Elixir Clan and Elixir Drop registered
-- (public ids: they ride every authorize URL), joined to oauth_client so
-- a database without them (every test database) seeds nothing. A
-- provisioned client never expires; getClient keeps expires_at at
-- infinity instead of sliding it.

set local lock_timeout = '5s';

create table family_oauth_client (
  client_id              text primary key references oauth_client,
  app                    text not null unique,
  secret_hash            text check (secret_hash ~ '^[0-9a-f]{64}$'),
  secret_required        boolean not null default false,
  last_authenticated_at  timestamptz,
  provisioned_at         timestamptz not null default now(),
  check (not secret_required or secret_hash is not null)
);

insert into family_oauth_client (client_id, app)
select v.client_id, v.app
from (values
  ('YwoeaamoxCWpJk5RtiJQ9jlZ', 'clan'),
  ('VXtJ6x8GxJFPkxh3qR4uFrbY', 'drop')
) as v (client_id, app)
join oauth_client c on c.client_id = v.client_id;

update oauth_client set expires_at = 'infinity'
where client_id in (select client_id from family_oauth_client);
