# 2026-11-13 — The JSON API's clan fact and clan mail doors go (4.0.0)

Clan is a set of features inside Elixir (Jamie, 2026-11-12). Its morning
run already writes its award standings and sends its Actions mail in
process (#879, #887), so the `/api/v1` doors it once used are gone, a
JSON API major Jamie approved ("merge and deploy the /api/v1 major that
removes the clan facts and clan mail routes").

Removed from `/api/v1` 4.0.0:

- `POST /clans/{tag}/facts` and `DELETE /clans/{tag}/facts/{ref}`, in
  both forms: a person's (OAuth `clans:attest`) and a family app's
  (integration key, `facts:write`).
- `POST /clans/{tag}/mail` and the `mail:send` permission, which no
  longer exists (the admin Integrations page drops its box, and creating
  a key with it is refused as an unknown permission).
- The family-app checks those writers carried (`family_apps_only`).

A removed path answers the unknown operation's 404 (`not_found`, "No
/api/v1 operation answers..."), before any credential is read.

Kept: the `clans:read` reads (poapkings.com's roster and war history),
`POST /players/{tag}/facts` (`facts:write`), the person reads and Drop's
sign-in. A person in Clan still writes their clan's facts through Clan's
own web API (`writeClanFactInClan`, `services/web-api/src/clan.mjs`),
and Clan's computed
facts still go through `writeClanFactBySystem`. Stored values are
unchanged: a person's clan facts keep the source `clan.poapkings.com`,
Clan's own facts and mail keep `elixir-clan` and the label "Clan", and
the `elixir-clan` integration account row stays as their attester.

Left in place on purpose: the `elixir.poapkings.com` entry in
`FIRST_PARTY_ORIGINS` (`packages/auth/src/oauth.mjs`) and Clan's retired
OAuth client row. The `clans:attest` OAuth scope is still grantable (it is
part of OAuth and MCP discovery) but no operation takes it now; the docs
say so.

No consumer used these doors: poapkings.com reads the roster and war
history, Drop the player, profile refresh, clock and sign-in operations,
and elixir-mcp-discord none of them. No What's new entry: no person
notices.

JSON API 4.0.0. MCP unchanged.
