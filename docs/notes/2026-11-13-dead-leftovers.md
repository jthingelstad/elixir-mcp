# 2026-11-13 — What two cleanup passes left, and a collector notice the relay dropped

No MCP tool, `/api/v1` operation, contract version, migration or stored
data changes.

## A bug fixed

- **`gateway_silent` joins `OWNER_NOTIFY_KINDS`** (`packages/contracts`,
  `queue.ts`). The jobs sweep has sent "collector silent" to the owner
  since 2026-09-19 (`services/jobs/src/fleet.mjs`), and the relay has a
  subject and lead line for it, but the kind was never in the list the
  relay validates against, so every one was dropped as
  `owner_notify_drop invalid_message`. The fleet test now runs the
  notice through `validateEmailMessage`. It reaches the owner from the
  next deploy.

## Removed

- `services/jobs/test/digest-fixture.mjs`: `milestoneFixture`, `PRIMARY`,
  `ALT`, `OPPONENT` and `WINDOW`, unused since the milestone mail went.
- The mail palette's `youRow`, `youChip` and `youEdge` (`youInk` stays,
  the collector table's "checking in").
- `verifiedClans` from the mail's `readerDoors`: nothing passed it to the
  renderer after the clanmate map went (#764), so its query went too.
- `{duel_round_decks}` (`services/migrate/src/ops-duel-rounds.mjs`, its
  test, its `lambda.mjs` branch and its `ops` skill row): the 0182 fill
  ran on 2026-09-26 (the deck rows it added are why `{vacuum}` takes
  `deck` and `deck_card`), and ingest writes a round's deck itself. A
  payload with the key is now refused as unknown.
- `infra/scripts/secret-add-keys.mjs`: it read the app secret's value,
  which agents never do (`docs/SECRETS.md`: Jamie edits a key in the
  console); `bootstrap.mjs` says so now.
- `packages/contracts/test/fixtures/clans-context-mcp.json`, read by no
  test since `clans_context` retired in 12.0.0.
- The Rail's unused props and fields: `sub`, `aside`, `back`, `foot`,
  an item's `subs` and `attention`, and the `RailFoot` and `RailSub`
  types. Settings and Admin were the last callers and pass none. Their
  CSS (`.rail__back`, `.rail__foot`, `.rail__item--foot`) and tests went
  with them; `.rail__child` stays for the docs rail.
- The narrow `.rail__toggle` rule repeated at the foot of
  `components.css`: it restated the first one's values.
- Three re-exports from `packages/syndication/src/index.mjs`
  (`postRevision`, `clanWakeId`, `clanStoryFacts`) that nothing imports
  through the package. No syndication function was called only by
  tests: each one exported for a test is used inside its module.

## Renamed and corrected

- `MILESTONE_MAIL_KINDS` is `BIG_FIRST_KINDS`: the milestone mail is
  retired, and the set is the big firsts the digest and Home's Friends
  tell one by one.
- Bring your clan no longer says an agent reads a clan's war intent with
  an explicit grant (`clans_context`, retired in 12.0.0); your agent
  reads the policy's public part in the clan directory.
- Follow on a clan's page: the docs and today's What's new entry said a
  clan follow takes one of your clan slots. It takes none when an agent
  of yours already follows that clan (your slots are pooled with your
  agents, and a clan counts once).
- Sample names that may belong to real players: `TyTheTitan` in the UI
  kit test, and `Raquaza` and the nickname `Tyler` in two September What's
  new entries and the 0.21.0 change line, are invented ones now.

## Left, and why

- `{agent_recordings}`: its note says it "runs once after the deploy",
  and nothing records that it did. A re-run stops nothing, so it stays
  until a run is on record.
- `{tier_census}` and `{verified_tag_census}`: reusable reads, and
  DECISIONS cites `{verified_tag_census}`.
- `{clan_context}` in `MIGRATE_READS`: DECISIONS ("`clans_context`
  retires") keeps the grant storage and its op, and the preview is a
  read.
- `fixtures/events/bare_array.json`: the payload-manifest tests walk
  `fixtures/` by directory, and it is the `events` endpoint's only
  fixture.
- Migration 0035's comment names a player; applied migrations are
  immutable. The acceptance bites hold captured answers with players'
  names; that is a larger change than this one.
