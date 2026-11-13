# 2026-11-13 — /api/v1 keeps only GET /api/v1/me (JSON API 5.0.0)

Jamie, 2026-11-13, on the systems around Elixir: "It would make sense
... to limit their dependencies on Elixir ... The only thing that I have
a strong opinion on is that Elixir Drop uses Elixir authentication." And:
"Agree with your recommendations. I think you can make these calls
through this pivot."

Both JSON API consumers had already left: poapkings.com reads the Clash
Royale API itself (its `poapkings-com` key is revoked), and Drop uses
only the OAuth flow and `GET /api/v1/me` with `cr:read` and
`account:email`.

## What changed

- `/api/v1` answers exactly `GET /api/v1/me`, for a person's OAuth grant
  whose audience is `/api/v1` (an `eat_` token). Any other path or
  method is the unknown operation's 404 before a credential is read; any
  other credential, an integration key included, is a 401 at `/me`.
- `/me` adds `account_id`, the same value as `/oauth/userinfo`'s `sub`.
  The rest of the response is unchanged, so Drop's requests need no
  change.
- The contract (`packages/contracts/integration-api.openapi.json`, still
  served at `/docs/integration-api.json`) is 5.0.0 and declares only
  `/me`. `services/web-api/test/sign-in-api-contract.test.mjs` pins the
  path set and fingerprints it.
- Gone: `services/web-api/src/{integration-api,v1-operations,attested-facts}.mjs`,
  `routes/integrations.mjs` (`/api/admin/integrations`),
  `POST /api/me/integrations`, `packages/auth/src/integrations.mjs`, the
  web app's Admin → Integrations page, the jobs sweeps of
  `integration_profile_refresh` and `integration_usage`, and the
  `idempotency-key` request header CloudFront forwarded for profile
  refreshes.
- The `{integration}` op keeps `list` (each stored integration with its
  keys) and `revoke` (an integration's keys, by public id), plus
  `retire_legacy`. Everything that created or changed an integration is
  refused with `invalid_action`.

## What stays, and why

- The `integration` table and its accounts stay readable. Clan's morning
  run (`services/jobs/src/clan.mjs`) still reads `integration where
  name = 'elixir-clan'` for the account its awards and standings are
  attested by, so the table keeps a live reader.
- Stored `attested_fact` player rows written through the old door stay
  and are still read by the timeline; nothing writes new ones.
- No table or column is dropped here. Losing their last reader:
  `integration_profile_refresh` (whole table), `integration_usage`
  (whole table), and `integration.scopes`, `daily_limit`,
  `hourly_limit`, `refresh_limit`.
