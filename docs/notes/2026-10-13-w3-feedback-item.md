# 2026-10-13 — The feedback answer is a timeline item, and its mail tells it (#536 stage 2, first move)

Stage 2's first move in `docs/notes/2026-10-12-w3-spine.md` ("Staged
order" item 2), closing its "Stage 1 gap". MCP 11.13.0 (a minor: new
facts and a `follow` on one item kind). JSON API 3.2.0 unchanged. No
migration: the answer's words ride in `account_event.detail`, a jsonb
column that already exists.

## What changed

- **`account_feedback_responded` is one answer per item**
  (`accountItems`, `packages/tools/src/activity/entries.mjs`). A
  `feedback_responded` event is never folded into a burst
  (`ACCOUNT_BURST_MS` still folds the other account kinds), so two
  answers to two items inside a minute are two items. Its story is the
  feedback item: id `storyId("feedback", feedback_id)`, revision the
  answer's ordinal among that item's answers. Two answers to the same
  item inside one read are one item at the later revision.
- **Its words**, schema `account_feedback_responded/3`
  (`TIMELINE_KIND_SCHEMAS`, `packages/tools/src/activity/schemas.mjs`):
  `feedback_id`, `status`, `response`, `shipped_in`, `area`, `category`,
  `message` (its first 600 characters), `filed_at`, `answered_at`, and
  the account keys `count` (always 1) and `apps` (always empty), kept so
  the change is additive. `at` is the answer. Its `text` names the
  message and the status (`itemText`, `summary.mjs`).
- **Where it leads**: `follow` is `elixir_my_feedback` with that
  `feedback_id` (`followFor`, `follow.mjs`), which reads the item whole
  and marks its answer seen. The other account kinds still lead nowhere.
- **The answer's words are written with the answer**: `answerFeedback`
  (`packages/feedback/src/feedback.mjs`) puts `response` and
  `shipped_in` in the event's detail beside `feedback_id` and `status`,
  in the same statement that answers.
- **The mail is composed from the item**: `runFeedbackAnswers`
  (`services/jobs/src/email/feedback-answers.mjs`) selects what is owed
  with its gates and journal, then reads the account's own items for the
  answer's instant through `accountWindowItems` and `digest`
  (`services/jobs/src/email/digest.mjs`), and mails the item's facts.
  The facts and the rendered mail are identical to before on the
  fixture (`feedbackFixture`, `services/jobs/test/digest-fixture.mjs`;
  golden captured from the old SQL path at `e73e3093`).

### What stays on its own SQL

The owed-answer query stays, cut to delivery state: settled
`SETTLE_MINUTES`, the journal (`responded_at` distinct from
`response_mailed_at`), unread (`response_seen_at` null), words present,
the switch (`account_email_pref`), a person, approved, not the owner.
The spine note keeps the gates and journal with the mail at every
stage. The facts (area, category, message, filed, response, status,
shipped_in) are no longer read there.

## Product questions and the answers taken

1. **One id per feedback item, or a new item per revised answer?**
   [engineering] One id per feedback item, the revision rising with each
   answer. The spine note says both ("Stage 1 gap" point 4: a new item;
   "Staged order" item 2: one id). The brief decides: timeline principle
   2, "a story that grows (a sitting, a proof that lands late) is the
   same id at a higher revision, an update and never a retelling"
   [Jamie, 2026-10-11]. An answer revised is the item's story growing,
   and an agent that told the first answer says "and now..." for the
   second instead of telling a new story. Point 4 is superseded.
2. **Does a mail count as reading an answer?** [engineering] No, as
   today. The mail goes only while the answer is unread
   (`response_seen_at` null) and sending it marks nothing;
   `elixir_my_feedback` with `feedback_id` (the item's `follow`) and the
   Console's page mark it seen. A test pins it.
3. **Two answers to different items inside a minute?** [engineering]
   Two items, each its own story: the burst rule (#376) was for six
   connections revoked in a second, not for answers, which each carry
   their own words. The stage-1 pin in `digest.test.mjs` flips to this.
4. **An older revision read later.** [engineering] It tells its own
   words, which its event holds from 11.13.0. An event written before
   holds only `feedback_id` and `status`: when it is still the item's
   latest answer its words are the item's own (the row holds the latest
   answer), otherwise `response` and `shipped_in` are null, absence over
   a guess (timeline principle 1).
5. **The answer's status, or the item's status at send time?**
   [engineering] The answer's: the item tells the answer as given, with
   the status and `shipped_in` it was given with. Before, the mail read
   the row ten minutes later, so a status-only change inside the settle
   window reached the mail; now it does not. A status-only change after
   the mail reached neither, before or now.
6. **An owed answer with no item.** [engineering] Skipped and journaled
   (`no_item` in the run's details), never composed from the row: every
   door answers through `answerFeedback`, which writes the row and the
   event in one statement, so it does not occur outside a hand-made row.
7. **A once-a-day gate?** No. "One a day is for scheduled mail only"
   [Jamie, 2026-10-12] stands: an answer is event-based mail and flows
   when it happens, one mail per answer.

## Stage 2 still holds

- The weekly per-player item (per-mode counts, trophies from and to,
  most-played deck), with the spine note's default: every tracked player
  with battles in the week gets one.
- Friends and Arena week recomposed from items through `digest.mjs`,
  and the composer reading through `buildTimeline` rather than
  `buildPlayerEntry` once its quiet gate, dedupe, story merge and cap
  are proven neutral for milestone.
- #474's `ranked_demotion`, which needs an ingest event and a
  constraint migration.
