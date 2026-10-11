# 2026-10-11 — Feedback queue ergonomics (#377, #378)

Feedback #377 and #378 were filed by an agent working the queue for
Jamie, over a personal connection. MCP 11.10.0 (minor); JSON API 3.2.0.

## #377: on_behalf_of in the docs, not in the schema

`on_behalf_of` is an agent connection's argument (AGENT_ARGS in
`packages/tools/src/tools.mjs`; review 2026-09-27 §6.1): a personal
connection is its person's, and the record cannot tell whether the
person asked for a relay. `protocol.md` put it in the
`elixir_send_feedback` signature every connection reads. The docs were
wrong, not the schema. The fix is in the docs, plus
`packages/tools/test/docs-signatures.test.mjs`, which checks every
`tool({ ... })` signature in `apps/site/src/docs/` against what each
connection kind is actually served (`declarations(kind)`):

1. every named argument exists for every kind that can call the tool;
2. a full signature (one with `?` marks) names every argument a personal
   connection is served, except a one-size tool's `verbosity`.

On its first run it reproduced #377 and found three more drifts:
`elixir_track_player` and `elixir_track_clan` were missing `action`, and
`clans_participation` was missing `verbosity`.

## #378: the feedback system's ergonomics

1. **Compact listing and single read.** `elixir_my_feedback` has
   `verbosity: compact`, which returns titles, statuses and
   `has_response` with no bodies, and marks nothing seen, since nothing
   was delivered. `feedback_id` reads one item whole and marks its
   answer seen. The old full page still works.
2. **Census grouping.** The shape census files one item per endpoint and
   kind of finding, listing its fields in `context.paths`. #350–#362
   were one shape change filed as thirteen items. A field already on an
   open item, whether in the old `context.path` or the new
   `context.paths`, is not filed again.
3. **Related items.** A `feedback` ref kind names one of the filer's own
   items. Someone else's id is `not_yours`. `related_by` is the reverse
   lookup, in `feedback_read` and the single read. Use `follows_id` for
   a reply and a `feedback` ref to say two items are related.
4. **Impact or severity: declined.** It would be a filer-set,
   unverifiable field. Category, refs and the first line already say
   what an item is about, and the maintainer weighs it.
5. **Amend and withdraw.** Amending was already possible: `follows_id`
   on any of your own items. The docs now say so. Withdrawing is
   declined: a wrong filing is still evidence of what confused someone,
   and a follow-up that says so closes it.
6. **needs_info.** This is a new status (migrations 0216/0217). It is an
   answer, so the item leaves the pending queue, and the filer's reply
   through `follows_id` arrives as a new pending item. Every
   status-rendering surface has it: the Console chip and an "Answer the
   question" button, the answer email's label, and the Discord agent's
   operator DM.
7. **Quota exemption: declined** (Jamie, 2026-10-11). Filing counts
   against the daily quota like any call, and the quota is not a
   meaningful barrier to it.

Found along the way:

- `docs/OPERATIONS.md` still described the Clan `clan_maintenance`
  feedback lanes, which were retired on 2026-10-08. That text is
  removed.
- The `elixir_my_feedback` output schema hardcoded the status enum. It
  now derives from `FEEDBACK_STATUSES`.
- The `area` description had left out `recorder`.
