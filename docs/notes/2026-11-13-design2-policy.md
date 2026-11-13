# 2026-11-13 — Clan's policy, as house rules

Second design pass, part 1. Layout and words only: no policy semantics,
default, evaluation or visibility moved, and no read was added.

- **Policy tab** (`packages/clan-web/src/views/ClanPolicy.jsx`): the
  engine's `describePolicy` sections, unchanged, drawn as one card a rule
  by the new `components/HouseRules.jsx`, in a reader's order (about,
  minimums, removal, elder, counts, welcome). Minimums, removal and a
  ranked Elder show their numbers as tiles, read from
  `current.values`, which the policy read already gives every member.
  Each card has an address, `#rule-<key>`.
- **Standing** (`views/Standing.jsx`): How it works here uses the same
  cards (sentences only; the standing read carries no values), and You
  shows "The rule behind this" for a member's group, linking to the
  Policy tab's card. Group to rule: elder for holding, slipping and
  rising; minimums for participating and quiet; removal whenever the
  inactivity clock is set. Leaders have no group and see no line.
- **Run's editor** (`views/Policy.jsx`): a changed setting says "Was N"
  from the saved values, its box marked; the unit and range sit beside the
  box, not inside the label. The save bar is one row (status, Preview,
  Save), sticky only while the draft can be saved; the version note,
  What saving does and the preview sit above it, so the bar no longer
  covers the fields being changed. Versions list newest first with the
  one in use marked.

Not done, needing a read: the Policy tab cannot list the clan's awards
(the policy read does not carry them), and Standing's rule cards cannot
show numbers (the standing read carries no values).
