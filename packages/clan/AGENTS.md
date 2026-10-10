# Elixir Clan

`/clan` (API `/api/clan`): running a clan on its own versioned policy
against Elixir's record. Standing, the Elder band, the removal clock,
Actions leaders decide, holds, notes, awards, recruiting, scouting.
Product behaviour is on the public pages `apps/site/src/docs/clan-*.md`,
`standing.md` and `bring-your-clan.md`; what stands is the Clan section
of `docs/DECISIONS.md`.

## Where it lives

Clan is part of Elixir: one session, one React app, one web API, one
Postgres, one jobs runtime, one stack and deploy. No OAuth, store, build
or workflow of its own.

| Piece | Owns |
| --- | --- |
| `packages/clan-engine` | the pure engine: policy, evaluation, standing, actions, awards, words. No I/O, no clock |
| `packages/clan` (here) | orchestration: request handler, gate, roles, the manage service (`src/manage/`), the closed recorded reader, model drafting, sealing |
| `packages/clan-state` | the private management ledger (`clan_state`, migration 0196) and its Postgres adapter |
| `packages/clan-web` | the views and routes, joined into the one `apps/web` router |
| `services/web-api/src/clan.mjs` | the request adapter: the authenticated person plus the request's connected client |
| `services/jobs/src/clan.mjs` | the morning run, one recorded clan per tick |

## Rules

- **Clan reads Elixir through a closed in-process reader**
  (`src/recorded-client.mjs`): a fixed set of reads with a request-local
  credential made after Elixir authenticates the person, never a browser
  token, OAuth grant or integration key. Membership, verification and role
  are current checks on every request.
- **Private Clan state never reaches MCP or public tools.** The one
  exception is `clans_context`, through `@elixir-mcp/auth/clan-context`;
  `services/web-api/test/clan-boundary.test.mjs` pins the boundary.
- **Facts versus judgments.** Game facts come from the record; Clan's own
  results that other apps read (`award_standing`, clan facts) are attested
  facts written through `@elixir-mcp/record/attested-facts`, labelled and
  apart from the game record.
- **Nothing runs until a clan has a policy**, and reviews, Actions,
  standing and awards need ten members (`MIN_MEMBERS` in the engine).
  Nothing clan-specific (no POAP KINGS defaults) enters code; the
  engine's `no-clan-specifics` test holds that.
- **People decide.** Drafting words never completes or posts an Action;
  routine messages default to clan chat; delivery receipts are human
  records, never inferred.
- **Model drafting** uses the clan's own sealed key. Requests go through
  the outbox bucket under `clan-model/` to the non-VPC email relay, which
  claims each request once before calling the provider; payloads are
  sealed (`src/sealed.mjs`, HKDF domain per purpose); no key, prompt or
  answer is logged. The sealing secret (`clan_sealing_secret` in the app secret) keeps its
  derivation and AAD until its own reviewed rotation (`docs/SECRETS.md`).
  The key's model list refreshes itself (`refreshModels`, at most daily,
  asked for by Settings after it draws); nothing ever changes a clan's
  saved model.
- **Actions in Discord** go the same way, under `clan-discord/`
  (`src/discord-bridge.mjs`, `src/discord-webhook.mjs`,
  `src/manage/discord.mjs`): the webhook is sealed in its own item, the
  relay claims each post or edit before calling Discord, a post whose
  outcome is unknown is never made again, and nothing logs the webhook's
  address. `share` runs inside the clan's lock after each request and
  after the morning run.
- **`ClanInternal`** (stack parameter, `CLAN_INTERNAL`) is the feature
  switch. Turning it off disables Clan's API and morning run; it never
  resumes another runtime.
- Live repair goes through the IAM-only `{clan_maintenance}` migrate op
  (`.claude/skills/ops/`); sealed key items have no maintenance read path.

## Testing

`npm test -w @elixir-mcp/clan` (and each sibling package),
`services/web-api/test/clan*.test.mjs`, and the Playwright journeys in
`apps/web/e2e/clan/`.
