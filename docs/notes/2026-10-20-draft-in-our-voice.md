# 2026-10-20 — Draft in our voice: the floor, lines and a demotion's history (stage 1)

Jamie, 2026-10-20: "in Clan when we use the LLM token that the clan has
provided and do "Draft in our voice" for a leader action the intent is
that it should use the full data resources of Elixir to create a
meaningfully more in-depth and personalized message. Right now, it seems
to do the opposite and actually make the message even less useful. It
is almost always worse." The redesign he approved ("Approved: build the
Draft in our voice redesign in elixir-mcp (bug fixes, new prompt, full
member record, product calls 1-6 as recommended)") ships in three
stages. This is the first: the bug fixes, the prompt, the output's
shape, the demotion's packet, the read-only packet check, and calls 1, 3
(the packet half) and 4. It lands after stage 2, the member's dossier
and story angles (#607,
`docs/notes/2026-10-20-draft-dossier-and-angles.md`), and its prompt
starts from them. No contract change: MCP 11.13.1 and JSON API 3.2.0.
No migration.

Why drafts were worse:

- **No floor.** A production Action keeps its words in `card.delivery`
  and no `evidence.message`; the draft was given neither, so the model
  never saw what Elixir would have sent and wrote less.
- **The prompt asked for less.** "One or two details", "Never list
  statistics", "No speeches" and a demotion asked to be "short".
- **One line of 200.** A chat draft was one line, so a promotion's war
  weeks, tenure and award could not all fit.
- **A demotion was told the review's shortfall** and every packet the
  caveat "capture does not prove inactivity", which drafts repeated.
- **Two colons.** A heading ending "!" joined its body with ": ".

What changed:

- **The floor** (`clan-engine/words.mjs`, `clan/manage/drafts.mjs`).
  Every request carries ELIXIR'S PLAIN WORDS: the card's delivery
  template for its channel, or the in-game copy for a welcome, a removal
  or a farewell. The system says to say at least that, then go further.
- **The prompt.** Two to four facts of the member's own, starting from
  the STORY ANGLES, every number one the packet states, a number said
  for what it means, one fact to a sentence, and named filler banned
  ("by clan rules", "better with you in it", "keep climbing with us",
  "earned it" without the fact). Kept: nothing guessed or rounded, no
  score, rank, percentile or standing, no fame per member, no advice,
  the chat filter's rules. The system names the destination: the Inbox,
  or clan chat.
- **Lines** (call 1). `write_clan_chat {lines}` replaces the one-line
  chat tool: up to three lines for a promotion, two for a welcome, a
  demotion or a farewell, one after a removal (`CHAT_LINES`). A
  promotion or demotion drafted for clan chat uses it; the Inbox and an
  announcement keep `write_leader_message`. The card shows a field and a
  copy button per line; a welcome's decide takes `sent.lines` (an older
  page's `sent.line` still works) and shares two lines as two chat
  facts.
- **A demotion's packet** (call 3). It is told the Elder moves back to
  Member for now, the member's time in the clan, the awards they hold
  and the dossier's older history (stage 2): no trophies, recent war
  weeks, ranked battles, last battle or shortfall. The ask thanks them
  for good history and never says or hints why. The
  "capture does not prove inactivity" caveat and a promotion's "last
  captured battle" and "rests on" facts are told to no draft.
- **The leader's note** (call 4). A welcome and a confirmed departure
  take "What should it say?" beside the tone; the tone is its own field
  (`tone`) on the draft route. The words after a removal take only the
  tone, and a note there is refused (`bad_draft_tone`).
- **Checks, warnings only.** "This draft says less of the record than
  Elixir's plain words" names the plain words' numbers a draft leaves
  out; a demotion that hints at why is named; each chat line is checked
  for the filter and its length; the invented number and name checks
  stay.
- **`draft_packet`** (`services/migrate/src/ops-clan-maintenance.mjs`):
  a `clan_maintenance` read lane that builds the exact request for one
  Action, with the provider body for the use's first-choice model, in a
  read-only transaction. No model call, key or log entry.
- **The double colon** (`delivery.mjs` `chatLines`): a heading ending
  `.`, `!`, `?` or `:` joins its body with a space.

Defaults taken [engineering]:

- The words after a removal stay one line, asked within 170 characters;
  other lines are asked within 190, under the game's 200.
- An awards or policy announcement drafted for clan chat keeps its
  heading and message, which Elixir splits into lines as before.
- The Leader Message stays at 150 characters asked of 180 allowed. The
  180 is "bounded by typing, not read from a spec"
  (`cr-agent-api-docs/wiki-api-crosswalk.md`), so it was not raised.
- A demotion's member block carries no war weeks, trophies or profile:
  its recorded weeks are the last four, inside the window the review
  counted. Its older weeks come only from the dossier, cut before the
  policy's recent weeks.
- The floor check compares numbers only. A plain "N+" is met by any
  number of at least N; percentages and the awards' `{winners}` list
  are not compared.
- The hint words: lately, recently, recent weeks, quiet, missed or
  missing, inactive or inactivity, absent or absence, dropped, slipped,
  fell short, less active, been away, busy.
- A welcome line in the card's editor takes the game's 200 characters,
  as the server already allowed; Elixir's own welcome is still written
  to 120.
- A draft that was pending at deploy and answers in the old tool's shape
  is read as lines. An older page that sent a tone as the note is read
  as the tone.
- `draft_packet` answers a refusal as `draft refused: <code>`, and builds
  a closed Action as it would have been drafted. It does not check a
  removal's safety proof, which needs a person's sign-in.

`draft_packet` reads the record through the same `draftStory` call as
the web API, so the two change together. Left for stage 3: one "how our
messages sound" setting (call 5) and the draft text stored on its
"drafted" log entry (call 6).
