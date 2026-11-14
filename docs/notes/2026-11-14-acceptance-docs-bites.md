# 2026-11-14 — Optional fields no longer fail the docs audit by the day

The deploy gate failed `catalogue/elixir_timeline#docs`: "timeline-tool
documents crossed_by, arena_floor and no response this run carried it".
Both are optional facts: a timeline item carries them only when a
followed player crossed a trophy band or changed Arena inside the run's
windows, and that day's windows held none. Production still serves
them. The case passed or failed on what players did that day, the same
defect the kinds direction had (2026-11-13).

- **A bite is evidence.** A name the docs (`#docs`) or a response's
  notes (`#notes`) use that no response this run carried now counts when
  a committed bite of the same tool (`acceptance/bites/`, a captured
  answer of the deployed product, matched under the tool's current name)
  carries it as a key. Keys only, never values, and never a refusal.
- **Still a finding when served nowhere.** A name no response this run
  and no bite of that tool carried fails as before, so the Gym's I7
  (documented but not served) is kept. Another tool's bite does not
  count.
- **Said aloud.** Every name that passed on a bite alone is listed after
  the run (`docs provenance`), beside shape provenance, with the capture
  that holds it.

The tool's outputSchema could not carry this: `elixir_timeline` declares
`facts` as an open object. A bite records what a version served, so a
field removed after its capture would still pass; removals are majors
whose pull request edits the docs page, and the provenance line names
every field resting on a capture. `acceptance/acceptance.test.mjs` pins
both directions. No contract or migration change.
