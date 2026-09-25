# Archive

Documents that were true, are no longer, and are kept because the **reasoning**
in them is still worth reading.

Every file here opens with a banner saying what changed and where the current
answer lives. If you find one without a banner, that is a bug — an archived
document that does not announce itself is worse than a deleted one, because it
still reads like an instruction.

**Nothing in here is authoritative.** For what the product does:
<https://elixir.poapkings.com/docs>. For build invariants:
`docs/ENGINEERING.md`. For decisions: `docs/DECISIONS.md` (the reasoning
is in `docs/NOTES.md` and its weekly archives in `docs/notes/`).

| File | Was | Why it left |
|---|---|---|
| `DESIGN-v2-2026-09-03.md` | the "spec of record" | Described a model that had been replaced — no users/agents/integrations, a claims defaulting scheme relationships superseded — while `AGENTS.md` pointed every session at it as authoritative. |
| `DB-AUDIT-2026-09-04.md` | a database audit | A snapshot. The numbers moved; the method is the part worth keeping. |
| `DATA-TOOLS-2026-09-04.md` | a design for payload analytics | Half shipped (the S3 archive is live), half declined. Trend tooling turned out not to need the deferred half. |
| `DESIGN-HANDOFF-2026-09-05.md` | a prompt for a design session | The session happened and shipped. A prompt is not documentation. |
| `CLAN-PULSE.md` | the design of the clan pulse push lane | `clan_pulse` and `war_day_open` were retired on 2026-09-13 (contract 2.0.0, then `elixir_timeline` at 3.0.0), and `/docs/events` is gone. Banner added 2026-09-25; it had none. |
| `DOCS-GAP-2026-09-09.md` | a docs-vs-code gap inventory | A one-day snapshot; the docs rewrite it drove shipped the same day. |
| `FETCH-LOOP-AUDIT-2026-09-09.md` | the polling measurement and the loss bound | The session clock (2026-09-19) superseded the loss bound, the yield clock and the roster gate. |
| `META-INTEL.md` | the meta tools' statistical design | Its Pilot Score sections contradict "no branded or derived player metric, ever"; the methodology page describes what shipped. |
| `SITE-IA.md` | the navigation spec | The two-build split and the React foundation replaced the app it describes; its banner and body disagreed. |
| `TOP100-README.md`, `TOP100-SPEC.md` | Jamie's pre-build Top 100 bundle | Built after review; `docs/EMAIL.md` holds the reviewed design. |
| `CONSUMER-SURFACES.md` | the third-party consumer design | Its consumer status went stale; its two live principles moved to `docs/DECISIONS.md`. |

## Old path → new path

Migrations are checksum-immutable and the public changelog is published,
so both keep citing the paths a document had when they were written. This
table resolves them. Everything below moved or went on 2026-09-25.

| Old path | Now |
|---|---|
| `docs/DOCS-GAP-2026-09-09.md` | `docs/archive/DOCS-GAP-2026-09-09.md` |
| `docs/FETCH-LOOP-AUDIT-2026-09-09.md` | `docs/archive/FETCH-LOOP-AUDIT-2026-09-09.md` |
| `docs/META-INTEL.md` | `docs/archive/META-INTEL.md` |
| `docs/SITE-IA.md` | `docs/archive/SITE-IA.md` |
| `docs/top100/README.md` | `docs/archive/TOP100-README.md` |
| `docs/top100/SPEC.md` | `docs/archive/TOP100-SPEC.md` |
| `docs/CONSUMER-SURFACES.md` | `docs/archive/CONSUMER-SURFACES.md` |
| `docs/REVIEW-2026-09-10-DOCS-TOOLS-SEAM.md` | `docs/reviews/2026-09-10-DOCS-TOOLS-SEAM.md` |
| `docs/OPERATORS.md` | deleted (it was a "Moved" stub); <https://elixir.poapkings.com/docs/operators> |
| `docs/reviews/2026-09-18-TIME-SERIES-EXECUTION-BRIEF.md` | deleted (a spent execution brief; git history keeps it) |
| `docs/reviews/2026-09-19-INTERFACE-EXECUTION-BRIEF.md` | deleted (a spent execution brief; git history keeps it) |
| `docs/reviews/scripts/pilot-evolution-2026-09-19.py` | deleted (Pilot-era analysis script; git history keeps it) |
| `docs/reviews/2026-09-20-agent-seed-run-card-roles.json` | deleted (the archetype agent's spent seed run, graded 2026-09-20; the vocabulary lives in `cr-agent-api-docs` `data/card-roles.json`; git history keeps it) |
| `AGENT-TEAM/notes/<date>-<objective>.md` before 2026-09-14 | rolled into `AGENT-TEAM/notes/2026-W<nn>.md`, verbatim under per-file headings |

Earlier moves, into this directory: `docs/DESIGN.md` →
`DESIGN-v2-2026-09-03.md`, `docs/DATA-TOOLS.md` → `DATA-TOOLS-2026-09-04.md`,
`docs/DB-AUDIT.md` → `DB-AUDIT-2026-09-04.md` and `docs/DESIGN-HANDOFF.md` →
`DESIGN-HANDOFF-2026-09-05.md` (all 2026-09-08); `docs/CLAN-PULSE.md` →
`CLAN-PULSE.md` (2026-09-13).
