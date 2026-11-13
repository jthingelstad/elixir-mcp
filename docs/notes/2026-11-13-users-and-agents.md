# 2026-11-13 — Users and agents: the integration principal leaves the code and the docs (MCP 13.0.1)

The follow-up to `2026-11-13-api-v1-sign-in-only.md` (JSON API 5.0.0).
With the integration door gone, nothing in the code or the guides should
still describe an integration as something that connects ("No
integrations: Elixir has users and agents", DECISIONS).

## What changed

- **Principal kinds.** `PrincipalKind` is `person | agent`;
  `AGENT_ONLY_TOOLS` is gone and `toolsHiddenFrom` knows only the agent's
  hidden set (any other kind reads as a person). `resourceForPath` no
  longer maps `/i/<id>/mcp`: no door accepts an integration, and the
  CloudFront `/i/*` behaviour is gone, so the path is the site's 404.
  `validateServiceToken` admits only `mcp` keys of non-integration
  accounts. `createPrincipal` (and the `{principal}` op) creates agents
  only; any other kind is `invalid_kind`.
- **MCP wording (13.0.1, a patch).** The brief, a hidden tool's hint and
  the consent page name people and agents; `clans_roster`'s and
  `clans_participation`'s output descriptions no longer say `/api/v1`
  serves those rows. No field or argument changed.
- **Docs.** `/docs/json-api` and `/docs/integrations` are deleted, with
  no redirect (they are the site's 404). `/docs/sign-in-with-elixir`
  carries `GET /api/v1/me`, its answer and an `## Errors` section (the
  door's problem `type` points there). Attested facts moved to
  `/docs/timeline#attested-facts`. Connections is "Users and agents";
  roles, limits, protocol, glossary, architecture and the pages that
  named `/api/v1` operations or integration keys say what is true now.
  `site.test.mjs` checks the copy offers no integration and that the
  two old pages are not built.
- **Repo guides and skills.** ENGINEERING's JSON API section, AGENTS.md
  rule 5, `packages/tools/AGENTS.md`, DECISIONS door lists, and the
  ship, tool-change, gym, consistency and ops skills no longer describe
  tool mirrors, integration keys or `integration-pin`.
- **Comments.** Code that said `/api/v1` serves a tool's rows names the
  web app; invoker tests that read objects use the `web` surface;
  `elixir_send_feedback` maps only the MCP door (stored `api` feedback
  keeps its label).

## What stays

- `services/jobs/src/clan.mjs` reads `integration where name =
  'elixir-clan'` as the account Clan's facts are attested by, so the
  `integration` table, the `not exists (select 1 from integration ...)`
  guards in OAuth and the stored-row branches (`tierSql`, the claims
  owner check, `ops-account-remove`) stay.
- `/docs/privacy` still says some data reaches people "through the JSON
  API"; it is a policy page and changes only with Jamie's word.
- `oauth_family.resource`'s CHECK (0054, 0160) still admits `/i/<id>/mcp`;
  the code is narrower and no migration was made.
