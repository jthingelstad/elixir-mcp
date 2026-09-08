# Archive

Documents that were true, are no longer, and are kept because the **reasoning**
in them is still worth reading.

Every file here opens with a banner saying what changed and where the current
answer lives. If you find one without a banner, that is a bug — an archived
document that does not announce itself is worse than a deleted one, because it
still reads like an instruction.

**Nothing in here is authoritative.** For what the product does:
<https://elixir.poapkings.com/docs>. For build invariants:
`docs/ENGINEERING.md`. For decisions: `docs/NOTES.md`.

| File | Was | Why it left |
|---|---|---|
| `DESIGN-v2-2026-09-03.md` | the "spec of record" | Described a model that had been replaced — no users/agents/integrations, a claims defaulting scheme relationships superseded — while `AGENTS.md` pointed every session at it as authoritative. |
| `DB-AUDIT-2026-09-04.md` | a database audit | A snapshot. The numbers moved; the method is the part worth keeping. |
| `DATA-TOOLS-2026-09-04.md` | a design for payload analytics | Half shipped (the S3 archive is live), half declined. Trend tooling turned out not to need the deferred half. |
| `DESIGN-HANDOFF-2026-09-05.md` | a prompt for a design session | The session happened and shipped. A prompt is not documentation. |
