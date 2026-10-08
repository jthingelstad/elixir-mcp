# Rotating a secret

What each secret is, where it lives, and how to change it without signing
anybody out or breaking a link already sent. No value ever enters this repo, a log, or an agent's context:
the steps that need a value are Jamie's, in the Secrets Manager console.

| Secret | Lives in | Read by | Rotation below |
| --- | --- | --- | --- |
| `session_secret` | app secret `elixir-mcp/app` | web-api, mcp (sessions); jobs (older unsubscribe links) | Session secret |
| `session_secret_previous` | app secret, only during a rotation | web-api, mcp, when `SessionSecretPreviousInSecret=true` | Session secret |
| `unsubscribe_secret` | app secret | web-api, jobs, when `UnsubscribeKeyInSecret=true` | Unsubscribe key |
| `db_password` | app secret; the RDS master password | the six database functions and the `Database` resource | Database password |
| `buttondown_api_token` | app secret | email-relay | Any other app-secret key |
| `clan_sealing_secret` | app secret | web-api, email-relay (`CLAN_MODEL_SECRET`, when `ClanInternal=true`): seals Clan's stored model keys | Clan sealing secret |
| `OriginSecret` | a NoEcho stack parameter | CloudFront sends it; web-api, mcp and collector require it | Origin secret |

**CloudFormation reads a secret only when the resource holding the
reference changes.** Editing a value in Secrets Manager changes nothing
live until a deploy updates the function. `--param=SecretEpoch=<date>`
changes an environment variable on all seven functions that hold a
reference, so every reference is read again.

**CloudFormation also re-reads the previous template's references on a
rollback.** Remove a key from the app secret only after a deploy that no
longer references it has succeeded.

Every deploy below runs from an up-to-date, green `main`:
`AWS_PROFILE=cloud-engineer node infra/scripts/deploy.mjs --skip-web ...`.

## Unsubscribe key (once)

Unsubscribe links were signed with the session secret, so rotating it
broke every link already sent. A link signed with its own key carries the
key id `u1.`, and a link with no key id is checked against the session
secrets.

1. Jamie, in the console: `elixir-mcp/app`, Retrieve secret value, Edit.
   Add the key `unsubscribe_secret` with a new value (`openssl rand -hex 32`).
2. Deploy with `--param=UnsubscribeKeyInSecret=true`.
3. Check: the next mail's unsubscribe link starts `t=u1.`, and an older
   link still opens its page.

Do this before the first session rotation. The links sent before it stay
tied to the session secret until that secret's previous value is dropped.

## Session secret

Tokens are signed with `SESSION_SECRET` and verified against it and
`SESSION_SECRET_PREVIOUS`. The database session row stays the sign-out
authority throughout.

1. Jamie, in the console: `elixir-mcp/app`, Edit. Add
   `session_secret_previous` with the current `session_secret` value,
   then set `session_secret` to a new value (`openssl rand -hex 32`).
2. Deploy with `--param=SessionSecretPreviousInSecret=true --param=SecretEpoch=<YYYY-MM-DD>`.
3. Check: a browser that was signed in before step 1 is still signed in,
   and signing in again works.
4. Later, drop the previous value. After a leak, drop it at once. After a
   routine rotation, drop it after 90 days, the token cap: a token signed
   with the old value is refused from then on. Deploy with
   `--param=SessionSecretPreviousInSecret=false`. Only after that deploy
   succeeds, remove `session_secret_previous` in the console.

`packages/auth/test/auth.test.mjs` rehearses the whole sequence against
a scratch database ("a session-secret rotation signs nobody out").

## Origin secret

The deploy owns this value; nobody types it.

1. Deploy with `--rotate-origin-secret`. The deploy reads the current value
   from the deployed web door, mints a new one, and sets both
   `OriginSecret` and `OriginSecretPrevious`. The template makes
   CloudFront wait for all three doors (web-api, mcp, collector), so they accept the new value
   before any edge sends it. The edges that still send the old value are
   served while the distribution deploys.
2. Once that deploy has finished, deploy with `--param=OriginSecretPrevious=`
   (empty). Until you do, the next `--rotate-origin-secret` refuses to run.

## Database password

RDS has one master password, so for a few minutes the functions and the
database disagree. Choose a quiet hour.

1. Jamie, in the console: `elixir-mcp/app`, Edit. Set `db_password` to a
   new URL-safe value (`openssl rand -hex 24`). Nothing changes live yet.
2. Deploy with `--param=SecretEpoch=<YYYY-MM-DD>`. The deploy's migration
   step still runs on the old password, which is still the database's.
   The stack update then re-reads `db_password` into all six database
   functions (web-api, mcp, collector, scheduler, migrate, jobs). From here until
   step 3 they cannot connect, so the deploy's smoke fails. That failure
   is expected.
3. Jamie, in the RDS console: `elixir-mcp-enc`, Modify, set the master
   password to the same new value, Apply immediately. The instance does
   not reboot.
4. Check: `AWS_PROFILE=cloud-engineer node infra/scripts/smoke.mjs` passes, and
   `https://elixir.poapkings.com/api/public/status` shows `"ok":true`.
   Every function opens a new connection per invocation, so none keeps
   the old password.

The `Database` resource keeps its reference to `db_password`.
CloudFormation re-reads its `MasterUserPassword` only when that resource
itself changes. By then step 3 has already set the database to the same
value.

## Clan sealing secret

Not rotated. It seals the model keys Clan stores, so a new value would
leave every sealed key unreadable. Its value moves between secrets
unchanged, and the derivation (HKDF salt `elixir-clan`, per-purpose info)
and AAD must not change with code or storage moves; a new value waits for
a reviewed rotation that re-seals every stored key.

It was the `session_secret` key of `elixir-clan/app`, the old standalone
Clan app's secret, until it moved into the app secret as
`clan_sealing_secret` (2026-10-08). Delete `elixir-clan/app` only after a
deploy that reads `clan_sealing_secret` has succeeded.

## Any other app-secret key

Edit the key in the console, then deploy with
`--param=SecretEpoch=<YYYY-MM-DD>`.

## The database's certificate

Every `DATABASE_URL` says `sslmode=verify-full`. Each database function's
package carries the us-east-1 RDS root CAs
(`infra/certificates/rds-us-east-1-bundle.pem`, loaded through
`NODE_EXTRA_CA_CERTS`). The bundle holds the roots only: the server sends
its intermediate, and RDS asks that no intermediate be pinned. The bundle
covers `rds-ca-rsa2048-g1` (the instance's CA) and the rsa4096 and ecc384
roots, which all expire in 2061 or later. A move to another CA needs no
code change unless that CA is a new one outside this bundle.
