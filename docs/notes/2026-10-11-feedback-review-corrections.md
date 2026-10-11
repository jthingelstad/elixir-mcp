# 2026-10-11 — 11.10.1: corrections from Codex review of #479

Follows `2026-10-11-feedback-queue-ergonomics.md`. MCP 11.10.1 (patch);
JSON API 3.2.0 unchanged.

- The JSON API's GET /feedback built its tool arguments from a fixed list
  (`FEEDBACK_QUERY` in `services/web-api/src/integration-api.mjs`) that
  still named only status, since and area. The 3.2.0 document listed
  `feedback_id` and `verbosity`, but the route never passed them on.
  This is the same class of drift as #377: a hand-copied list beside the
  contract. `integration-routing.test.mjs` now pins both parameters.
- `answerFeedback` refuses `needs_info` without a new question
  (`needs_question`). Before, a status-only needs_info raised no
  pending hint and relabelled the old answer as a question.
- `applied.verbosity` reports `full` on a full page.
