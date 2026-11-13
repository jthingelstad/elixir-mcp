# Clan

`/clan` (API `/api/clan`): running a clan on its own versioned policy
against Elixir's record. Standing, the Elder band, the removal clock,
Actions leaders decide, holds, notes, awards, recruiting, scouting.
Product behaviour is on the public pages `apps/site/src/docs/clan-*.md`,
`standing.md` and `bring-your-clan.md`; what stands is the Clan section
of `docs/DECISIONS.md`.

## Where it lives

Clan is a set of features inside Elixir, not a separate product or an
integration (Jamie, 2026-11-12): one session, one React app, one web API,
one Postgres, one jobs runtime, one stack and deploy. No OAuth, store,
build or workflow of its own. A remnant that treats Clan as a separate
client is a defect to remove.

| Piece | Owns |
| --- | --- |
| `packages/clan-engine` | the pure engine: policy, evaluation, standing, actions, awards, words. No I/O, no clock |
| `packages/clan` (here) | orchestration: request handler, gate, roles, the manage service (`src/manage/`), the closed record reader, model drafting, sealing |
| `packages/clan-state` | the private management ledger (`clan_state`, migration 0196) and its Postgres adapter |
| `apps/web/src/clan` | the views and routes, in the one `apps/web` router |
| `services/web-api/src/routes/clan.mjs` | Clan's routes in the web API's route table: sign-in first, then the adapter |
| `services/web-api/src/clan.mjs` | the request adapter: the authenticated person plus the request's connected client, and the clan's lock (`clanLockPlan`) |
| `services/jobs/src/clan.mjs` | the morning run, one recorded clan per tick |

## Rules

- **Clan reads the record in process** (`src/record.mjs`, over
  `makeRecordReader` in `@elixir-mcp/tools/invoker`): the same tools
  every door answers from, closed to the reads Clan makes, with no
  credential, audit row or client name. The web path reads as the person
  Elixir has already signed in; the morning run as Elixir itself
  (`SYSTEM_READER`). The reader enforces nothing about the clan, so
  membership, verification and role are current checks on every request
  (the gate, `RUN_READS`, the elder and leader checks), and a leader's
  change also needs the roster read within the hour
  (`src/role-freshness.mjs`). `services/web-api/test/clan-record-reads.test.mjs`
  holds the reads to what the audited invoker answered, and
  `clan-record-access.test.mjs` holds who is refused.
- **Private Clan state** (leader notes, holds, decisions) **reaches only
  those the clan's policy allows, and never MCP or public tools.** The one
  exception reads through `@elixir-mcp/auth/clan-context`: `clans_my_view`,
  a person's own view
  (the policy summary, their own standing line, the Actions waiting for
  them; never a removal), shaped by `clan-engine`'s `own-view.mjs`, the
  code Clan's own "You here" uses
  (`docs/notes/2026-10-13-w3-my-clan-view.md`).
  `services/web-api/test/clan-boundary.test.mjs` pins the boundary.
- **Facts versus judgments.** Game facts come from the record; Clan's own
  results that the rest of Elixir reads (`award_standing`, clan facts) are attested
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
  asked for by Settings after it draws). Clan chooses the model
  for each use from `MODEL_FOR` (clan-engine `words.mjs`) against that
  list; leaders choose the key and the monthly cap, never the model.
- **Actions in Discord** go the same way, under `clan-discord/`
  (`src/discord-bridge.mjs`, `src/discord-webhook.mjs`,
  `src/manage/discord.mjs`): the webhook is sealed in its own item, the
  relay claims each post or edit before calling Discord, a post whose
  outcome is unknown is never made again, and nothing logs the webhook's
  address. `share` runs inside the clan's lock after each request and
  after the morning run. Each post and edit, and what Discord answered,
  is a row in the Discord quality ledger (`quality` dep,
  `@elixir-mcp/syndication/quality`; the delivery history carries its
  `ledger_id`).
- **The clan's activity in Discord** (Run ▸ Discord, for the leaders) is the
  timeline cross-post's pipeline, not Clan's bridges: the connection and
  sync are `packages/syndication` (`clan-settings.mjs`, `clan-sync.mjs`,
  the editor's read-only lookups `editor-research.mjs`), the rules
  `clan-engine/activity.mjs`, the stories and Elixir's render
  `clan-engine/stories.mjs`, the editor `clan-engine/editor.mjs`, the
  leaders' service `src/manage/activity.mjs`. The editor is the one model
  use posted unread (`writeUnattended`, purpose `discord_activity`, up to
  three rounds a run on the `timeline-editor/` queue): the model is told
  the record (`clan-engine/context.mjs`, the same builder as the drafts),
  and the engine's checks decide what is posted. Its model calls run
  outside the sync's transaction, under the clan's session lock. Each
  run is a `discord_run` row and its raw record (context, stories,
  every round's answer and lookups, the checks) an archive object under
  `discord-runs/` for 30 days: anything added to the editor's request
  lands there too, never a key or a webhook.
- **Clan posts to Discord; the separate Discord agent converses**
  (`docs/product/clan.md` principle 10, `docs/product/timeline.md`).
  Actions and activity stories reach a clan's Discord through webhooks
  its leaders connect in Clan, for any clan, sealed per clan. Clan has
  no ask lane and no inbound Discord handling: conversation (members'
  questions) is elixir-mcp-discord's, run by a clan on its own tokens.
  Acting from Discord (deciding an Action, marking away) is deliberately
  undecided; until it is decided, every write happens in Elixir, and
  nothing here should be built or documented as if it were coming.
- **`ClanInternal`** (stack parameter, `CLAN_INTERNAL`) is the feature
  switch. Turning it off disables Clan's API and morning run; it never
  resumes another runtime.
- Live repair goes through the IAM-only `{clan_maintenance}` migrate op
  (`.claude/skills/ops/`); sealed key items have no maintenance read path.

## Testing

`npm test -w @elixir-mcp/clan` (and each sibling package),
`services/web-api/test/clan*.test.mjs`, and the Playwright journeys in
`apps/web/e2e/clan/`.
