# 2026-11-16 — Comments: the app's screens

The app half of comments (`2026-11-16-comments.md` is the server half and
its rules). Nothing here draws unless `/api/me` says `features.comments`,
which follows the stack's `CommentsEnabled` (off by default), and nothing
draws under an agent's scope.

## Where it shows

- **Home's feed.** A card about a verified player carries its newest two
  comments, "See all N comments" and "Comment". The thread opens in place
  with the box to write in when the owner's setting lets you, or a line
  saying it is closed to you. An item that takes none (`comments: null`)
  draws nothing.
- **A player page** (Timeline, Highlights, Moments), **a sitting's page**
  and **a battle's cheers**: a "Comments" button that reads the thread on
  a tap. Outside your feed the read answers 404 and the thread says
  comments show for players in your feed.
- **The composer:** 280 characters with a count, "Checking" while the
  check runs, and on a no the server's one plain line, with the words kept
  so they can be changed.
- **Each comment:** who (to their player page, with the verified mark),
  when, the words as plain text (never links, Markdown or tags), and
  Delete (yours), Remove (on your play: kept 30 days in case it needs a
  look), Report (one reason of eight; you stop seeing it at once) and
  Block (asks first, says exactly what it does).
- **Block** also sits on another account's page (beside Follow) and on
  another player's page header (under the verified line), so the
  player header keeps "two actions at most". On a page you have blocked,
  Unblock takes Follow's place.
- **Settings › Comments & blocks** (`/settings/comments`, on the rail
  only while comments are on): who may comment on your play (people who
  follow you, people you follow, nobody), a paused line when an admin has
  paused your commenting, and the people you have blocked, each with
  Unblock. A block is silent: this list is the one place it shows.
- **The bell:** "<name> commented" with the words, opening the page of
  your player it is about (the server's bell row now carries
  `subject_tag`). It is the only place a comment reaches you; opening the
  bell marks them seen like everything else.
- **Admin › Comments:** the month's spend against the cap and the check's
  counts; reported comments with their reasons, Remove and Dismiss, and a
  form to pause the writer's commenting for some days; the accounts
  paused, each with Lift; the check's recent refusals with their words
  (kept only on a refusal, swept at 35 days).

## Built with

The kit's `Panel`, `Rows`, `Row`, `Chips`, `ConfirmAction`, `PageHead`,
`Empty` and `ErrorState`; one new icon (`message-circle`) and one new
block of component CSS (`kit-comments`). No inline styles. Tests:
`apps/web/test/comments.test.jsx` (the lists against migration 0282, off
draws nothing, the card, a refusal, the character limit), the bell's
comment row in `bell-logic.test.js`, the rails in `rail.test.jsx`, and
`e2e/comments.spec.ts` (each screen at 320 and 390 with axe and nothing
scrolling sideways, and comments off).

The public docs and a What's new entry are held with the server half's
(Held for Jamie there): they ship when comments are turned on.
