# 2026-11-14 — An aborted jobs run enqueues nothing more

Follow-up to #1042 (#814), from its Codex review. When a run is aborted
(its deadline, or its connection lost) `runJob` settles the handler,
but the run's own code keeps going from whatever it was awaiting. A
mail delivery awaits its archive write before the outbox write; an
archive write that finished after the abort could still hand the mail
to the outbox, while the send record that follows fails on the
destroyed connection. The retry would then find no record and send the
mail again. The continuation can also resume in a later invocation that
reuses the Lambda environment.

What changed:

- `assertRunLive()` (`services/jobs/src/db.mjs`) throws the run's
  abort error once the run is aborted. The run's context follows every
  continuation, so the check holds wherever the leftover code resumes.
- `guardS3(client)` puts that check in front of every send of an S3
  client. The jobs Lambda's outbox (all of its mail, the newsletter
  hand-off, the wakes), its mail archive, and Clan's Discord outbox and
  model storage use guarded clients, so no write starts after an abort.
  Database queries already rejected after an abort.
- Not covered: a write already on the wire when the abort lands still
  completes. That window is one S3 request, and it existed before as a
  Lambda timeout between the outbox write and the send record.

`services/jobs/test/jobs-db.test.mjs` holds a run at its "archive
write" past the deadline, then lets it continue: the outbox write is
refused and nothing reaches the bucket. No schema, contract or
player-visible change.
