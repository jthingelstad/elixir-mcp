# Archive index

The documents that used to live here, the finished reviews in
`docs/reviews/` and the weekly notes that sat in `docs/notes/` were
deleted on 2026-10-08 (`docs/notes/` holds per-change notes since
2026-10-10). Git keeps them. Each row names the last commit that changed
the file, so

    git show <sha>:<path>

prints it as it last stood. None of it is authoritative: what the product
does is <https://elixir.poapkings.com/docs>, the build invariants are
`docs/ENGINEERING.md`, what stands is `docs/DECISIONS.md`, and open items
are GitHub issues.

Shipped migrations (`db/migrations`, checksum-immutable) and the published
changelog (`packages/contracts/src/changes/`) still cite these paths.
They are not edited; this table resolves them.

## Archive bodies

| Path | Last commit |
| --- | --- |
| `docs/archive/2026-10-02-EMAIL-BEFORE-RETIREMENT.md` | `a2784939` |
| `docs/archive/CLAN-PULSE.md` | `283703ed` |
| `docs/archive/CONSUMER-SURFACES.md` | `283703ed` |
| `docs/archive/DATA-TOOLS-2026-09-04.md` | `7a2b6ad1` |
| `docs/archive/DB-AUDIT-2026-09-04.md` | `7a2b6ad1` |
| `docs/archive/DESIGN-HANDOFF-2026-09-05.md` | `7a2b6ad1` |
| `docs/archive/DESIGN-v2-2026-09-03.md` | `e4371fe8` |
| `docs/archive/DOCS-GAP-2026-09-09.md` | `283703ed` |
| `docs/archive/FETCH-LOOP-AUDIT-2026-09-09.md` | `283703ed` |
| `docs/archive/META-INTEL.md` | `283703ed` |
| `docs/archive/SITE-IA.md` | `283703ed` |
| `docs/archive/TOP100-README.md` | `283703ed` |
| `docs/archive/TOP100-SPEC.md` | `283703ed` |
| `docs/archive/README.md` (the previous index, with the 2026-09-25 old-to-new moves) | `283703ed` |

## Reviews

| Path | Last commit |
| --- | --- |
| `docs/reviews/2026-09-10-DOCS-TOOLS-SEAM.md` | `283703ed` |
| `docs/reviews/2026-09-11-DATA-FLOW-EFFICIENCY.md` | `d235d543` |
| `docs/reviews/2026-09-13-EVENT-FEED.md` | `52bad21d` |
| `docs/reviews/2026-09-16-SCHEMA-REVIEW-BRIEF.md` | `03c45f57` |
| `docs/reviews/2026-09-16-SCHEMA-REVIEW.md` | `283703ed` |
| `docs/reviews/2026-09-16-TIMELINE-FOR-PROACTIVE.md` | `283703ed` |
| `docs/reviews/2026-09-18-INTERFACE-REVIEW-BRIEF.md` | `283703ed` |
| `docs/reviews/2026-09-18-TIME-SERIES.md` | `97fa5ed5` |
| `docs/reviews/2026-09-19-CARDS-REVIEW.md` | `9a88ed80` |
| `docs/reviews/2026-09-19-ELIXIR-LIFT-TWO-POPULATIONS.md` | `4280e616` |
| `docs/reviews/2026-09-19-INTERFACE-REVIEW.md` | `283703ed` |
| `docs/reviews/2026-09-19-PILOT-SCORE-ASSESSMENT.md` | `4999524d` |
| `docs/reviews/2026-09-19-PILOT-SCORE-EVOLUTION.md` | `283703ed` |
| `docs/reviews/2026-09-19-PILOT-SCORE-REMOVAL-PLAN.md` | `283703ed` |
| `docs/reviews/2026-09-20-DECK-ARCHETYPES-DESIGN.md` | `e71624e9` |
| `docs/reviews/2026-09-23-CONSOLE-ACCOUNT-SWITCHER.md` | `283703ed` |
| `docs/reviews/2026-09-26-DUEL-ROUNDS-IN-THE-CORPUS.md` | `3a7360ba` |
| `docs/reviews/2026-09-27-ARCHITECTURE-DURABILITY-FEATURES.md` | `45de983c` |
| `docs/reviews/2026-09-27-EXECUTION-BRIEF.md` | `c99e9fe9` |
| `docs/reviews/2026-10-02-ELIXIR-RIGHT-SIZING.md` | `dde047fb` |
| `docs/reviews/2026-10-03-CLAN-AWARDS-READINESS.md` | `5e9d68e8` |
| `docs/reviews/2026-10-03-CLAN-MONDAY-READINESS.md` | `5e9d68e8` |
| `docs/reviews/2026-10-03-CLAN-READINESS-TRACE.md` | `99af7871` |
| `docs/reviews/2026-10-04-POLICY-CONTEXT-CORE.md` | `451b9d6d` |

## Notes and retired prompts

| Path | Last commit |
| --- | --- |
| `docs/NOTES.md` (the last full version before this reset) | `bb01d62b` |
| `docs/notes/2026-W36-W37.md` | `cd61a98d` |
| `docs/notes/2026-W38.md` | `cd61a98d` |
| `docs/notes/2026-W39.md` | `51ccf152` |
| `docs/card-of-week/generator-prompt.md` | `60c6057f` |
| `docs/top100/generator-prompt.md` | `b76ce92d` |

Older moves (before 2026-09-25: `docs/DESIGN.md`, `docs/DATA-TOOLS.md`,
`docs/DB-AUDIT.md`, `docs/DESIGN-HANDOFF.md`, `docs/CLAN-PULSE.md`,
`docs/META-INTEL.md`, `docs/SITE-IA.md`, `docs/top100/README.md` and the
rest) are in the previous index: `git show 283703ed:docs/archive/README.md`.
