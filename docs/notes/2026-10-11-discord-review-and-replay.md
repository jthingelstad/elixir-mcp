# 2026-10-11 — Discord review: the op, the skill and the replay

The last of four changes for Jamie's "judge the quality of those without
having any access or visibility to the client discord server"
(2026-10-11; after `2026-10-11-discord-quality-ledger.md`,
`2026-10-11-discord-readback.md` and
`2026-10-11-discord-ratings-and-admin.md`). Admin ▸ Discord is Jamie's
view; this is the agent's path to the same evidence.

- **`{discord_review}`** is a migrate read (`npm run op`, allowlisted in
  `ops-invoke.mjs`; `services/migrate/src/ops-discord.mjs`): the
  window's summary (`{days}`), one destination whole (`{key, feature?,
  limit?}`, a clan tag or a timeline's account id) or the ratings to
  answer (`{ratings: true, days?}`, a 👎 or a note first, unanswered
  before answered, each with its post and `superseded` when the same
  person rated again). It reuses `quality-report.mjs`, so the op and
  Admin read one query.
- **`discord-review` skill** (`.claude/skills/discord-review/`): the
  reads, a twelve-line rubric (true to the record, names kept, no clock
  time, never judging a member, voice, skips, the checks' refusals,
  Discord's refusals and losses, deletions, ratings, latency, reactions
  as a weak signal) and where a finding goes: every rating answered as
  feedback, one GitHub issue per cause quoting ids only (the repository
  is public), notes in `../AGENT-TEAM/notes/`.
- **`npm run editor-replay -- <run_id>`** (`infra/scripts/editor-replay.mjs`
  over `packages/syndication/src/editor-replay.mjs`) reads one raw run
  from `discord-runs/` as cloud-engineer (the migrate role has no read
  there, and none was added) and either runs its own answer through
  today's checks (`--checks-only`, no key) or sends today's instructions
  with its own stories and context to the run's model (or `--model`) on
  the maintainer's own key from `ELIXIR_REPLAY_ANTHROPIC_KEY`. The key is
  handed to the model client and never printed; a clan's key is never in
  reach. Lookups are answered from the run's own, any other as not
  available, so a replay never reads the database. Nothing is posted or
  written. Its output names members and stays local.
- **Codex on #514**, both fixed here: only a post that reached the
  channel (`post` or `edit`, outcome `posted` or `edited`, or its receipt
  still on the way) takes a rating, at the door and in the list; and
  every rating count (a feature's 👍/👎/notes, a destination's
  `rated_down`) reads each person's latest rating of a post only.
- A replay sends a clan's run inputs (its stories and its members'
  names) to Anthropic on the maintainer's account: the same provider the
  clan's own key already uses, but a different account. The skill runs
  it only when a change to the editor is being judged.
