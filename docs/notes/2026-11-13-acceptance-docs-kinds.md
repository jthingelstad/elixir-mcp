# 2026-11-13 — The docs audit of kinds no longer depends on the day

The deploy gate failed `catalogue/elixir_timeline#docs`: "timeline-tool
documents account_feedback_responded and no response this run carried
it". The case accepted a documented name only if some response this run
happened to carry it, or it was declared vocabulary. The timeline's
account kinds are an open family, declared as "an account_* kind" in the
`kinds` argument's description, so they were never declared word by word
and passed only on a day the acceptance account had one in its window.
A check whose result depends on the day's data is a defect.

- **Documented means declared.** A documented name in an `x_*` family
  that the tool's own arguments declare (`declaredFamilies`, from "an
  account_* kind") counts as vocabulary, as an enum value already did.
  A documented name outside every declared family and never served still
  fails, so the I7 finding (documented but not served) is kept.
- **Carried means documented.** For a tool that filters by `kinds`
  (today `elixir_timeline`), every kind its responses carried this run
  (an item's `kind` whose `schema` is `<kind>/<version>`) must be named
  in its docs page, by itself or by a family (`account_*`).
- **Never required to appear.** No check asks that every documented kind
  turned up in the run.

`acceptance/acceptance.test.mjs` pins both directions against a fake
door. No contract or migration change.
