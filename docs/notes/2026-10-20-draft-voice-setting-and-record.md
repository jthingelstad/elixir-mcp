# 2026-10-20 — Draft in our voice: one voice setting and the draft kept in the log (stage 3)

The third stage of the Draft in our voice redesign Jamie approved on
2026-10-20 ("Approved: build the Draft in our voice redesign in
elixir-mcp (bug fixes, new prompt, full member record, product calls 1-6
as recommended)"): call 5, one "how our messages sound" setting for the
drafts and the Discord editor, and call 6, the model's words kept on the
"drafted" log entry. It follows stage 1
(`2026-10-20-draft-in-our-voice.md`) and stage 2
(`2026-10-20-draft-dossier-and-angles.md`). No contract change: MCP
11.13.1 and JSON API 3.2.0. Migration 0229.

## Call 5: one voice

Until now only the Discord activity editor had a voice, a column on its
connection (`clan_activity_discord.voice`, 0214), edited on Social ▸
Discord. "Draft in our voice" had none: it took the tone from the
recruiting pitch.

- **Storage** (`clan-state` `clanVoice` / `saveClanVoice`). One Clan
  ledger item, `voice#<clan>`, in the clan's partition beside
  `social#<clan>`, with who set it and when. 0229 copies each clan's
  non-empty editor voice into it as written (`copied_from: "0229"`,
  `copied_at`, no `set_by`, since the row's `set_by` is whoever last
  changed any Discord setting); an item already there wins, so a re-run
  copies nothing (`services/migrate/test/clan-voice-copy.test.mjs`).
  From this deploy no code reads or writes the old column, which 0229
  comments as such.
- **Expand and contract.** The deploy migrates before it flips, so the
  old code serves for a few minutes after 0229 commits, and a voice
  saved on the old page in that window reaches only the old column. The
  later contract migration that drops the column must first carry over
  any row changed after the item's `copied_at`, as 0170 did. Dropping it
  is its own change, after this one has deployed.
- **The setting** (`packages/clan/src/manage/voice.mjs`,
  `GET`/`PUT /api/clan/clans/<tag>/voice`). Verified leaders and
  co-leaders read and set it; a set is a leader mutation, so it needs
  the roster read within the hour. It is tidied as the editor's voice was
  (`tidyVoice`: one paragraph, no links, mentions or markup) and refused
  past 400 characters (`voice_too_long`), never cut. Empty clears it.
- **The rule** (`clan-engine/context.mjs` `VOICE_RULE`). THE CLAN block
  carries the voice as the leaders wrote it; both the drafts' system
  (`words.mjs` `writing()`) and the editor's rules (`editor.mjs`) say it
  sets the tone and the wording, never a fact, and never lifts a rule.
  The checks are unchanged: a number or a name a voice asks for that the
  record lacks is still caught by the invented-number and invented-name
  checks.
- **Readers.** The drafts read it in `prepare` (`drafts.mjs`); the editor
  through `voiceFor` (`clan-sync.mjs`, wired in `services/timeline-sync`
  and the web API's preview). `draft_packet` shows `voice`, so the read
  lane can confirm it reaches a draft.
- **The page.** Settings has a row, **How our messages sound**
  (`#settings-voice`, `clan-web` `VoiceSetting.jsx`), after the clan's
  model and its monthly limit, with the bound said beside the box. Social
  ▸ Discord shows the voice as written and links to it, with no box of
  its own; its preview runs in the saved voice. An older page that still
  sends `voice` with the Discord settings is saved through the voice
  service, under its rules. Event `clan.voice_set` (`set` or `cleared`).

## Call 6: the draft in the log

The "drafted" entry's `detail.draft` keeps what the model returned:
`{lines}` for clan chat, or `{title, body}`, strings only, before any
tidying, clipping or splitting, and nothing else of the request (no
member tags). `shapeAction` passes every log through `logFor`: a
verified leader or co-leader gets it whole; anyone else gets the entry
with `draft` removed. That is the server's line, pinned in
`packages/clan/test/manage.test.mjs` (an elder reading a welcome's log
gets the entry without the words; a leader and a co-leader get them),
and checked to fail when the leader branch is forced open. The log on
the Action's page shows the words under **What the model wrote**. A
draft made before this change has only the entry. The IAM-only
`action_log` maintenance lane reads the stored entries whole.

## Not done

- **League names.** The dossier says a best Path of Legends league by
  number. `cr-agent-api-docs` documents `leagueNumber` as 1-7, 7 the
  rated top league (`players.md`), and that a best result can carry
  more, but no verified number-to-name map; naming them would be a
  guess, so they stay numbers until the reference has one.
- Elixir's own demotion template is out of scope.

## Tests

Node tests: the copy (`clan-voice-copy`), the service (`voice.test.mjs`),
the activity view and its old-page save (`activity.test.mjs`), the
editor's packet and preview (`clan-sync.test.mjs`), the drafts reading
the voice and the stored words (`model.test.mjs`), the leaders-only line
(`manage.test.mjs`), the engine rule (`words.test.mjs`) and
`draft_packet` (`clan-maintenance.test.mjs`). Vitest: the Settings row
and its bound, the Discord page's read-only voice and link, the log's
words. Playwright (`apps/web/e2e/clan/our-voice.spec.ts`, wide and
narrow, axe): a leader sets the voice and Discord shows it and links
back; a leader reads the drafted words and an elder does not; an elder
or a member gets the refusal in Settings (`roles-readiness.spec.ts`).

No acceptance family runs: no MCP tool, `/api/v1` operation or contract
changed. The voice and the log are Clan's private `/api/clan` surface,
which the acceptance suite does not reach, and private Clan state never
reaches MCP.

## Defaults taken [engineering]

- The bound stays the editor's 400 characters, refused rather than cut.
- Only verified leaders and co-leaders read the voice, as only they use
  it (both of its uses are theirs).
- A voice may ask for another language, as the editor's could.
- Recruiting pitch drafts do not take the voice; it reaches the Action
  drafts and the editor, as the call named.
- The copied items carry no `set_by`; the page shows no "last set by"
  until a leader saves.
- The preview still accepts a trial voice from a caller; the page no
  longer sends one.
- The stored words are kept as long as the Action's log, with no expiry
  of their own.
