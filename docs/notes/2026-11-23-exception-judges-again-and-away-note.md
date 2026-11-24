# An exception judges the clan again; a leader's Away note stays with leaders

2026-11-23, from Codex's review of the exceptions change (#1233).

- **Saving or ending an exception judges the clan again at once.**
  `setException` and `endException` run `evaluateClan({ force: true })`
  after the write, so Actions are raised and withdrawn on the spot. A
  promotion for a member just set Not for Elder (or a demotion for one
  kept as Elder) leaves the inbox right away. Before this it stayed
  for up to five minutes, the time a reading is reused, and leaders
  could draft and complete it in that window. If the re-judging fails,
  the write still stands and the next read judges again. Removals keep
  their live exception check in the view as the backstop.
- **The member's own Away read (`GET /me/away`) carries the note only
  when they set it themselves.** A note a leader wrote is the why, which
  `/docs/clan-exceptions` keeps from members. The kind and end date are
  still shown.

Tests: `manage.test.mjs` ("Not for Elder withdraws a waiting promotion at
once", the leader-Away note), `removal-safety.test.mjs` (the removal is
withdrawn on the save; the view's guard still holds an exception the
reused reading has not seen).
