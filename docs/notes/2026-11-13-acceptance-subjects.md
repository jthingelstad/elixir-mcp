# 2026-11-13 — Acceptance names no player it reads

The acceptance catalogue named four players besides the owner. Many
players are minors and this repo is public, so no committed file names a
real player's tag except King Thing's and POAP KINGS'. Acceptance needs
recorded players, so they cannot be invented: the catalogue now holds
placeholders (`$CLANMATE_1` to `$CLANMATE_3`, `$COLLECTION_1`) and the run
resolves them from the POAP KINGS roster with its own credential
(`acceptance/subjects.mjs`): members sorted by tag, the owner left out,
the first with a recorded battle in the last 30 days, or the first whose
collection answers inside the result cap.

- Case ids are unchanged; a placeholder that cannot be resolved skips its
  case with the reason rather than failing it.
- Resolved tags are printed masked, redacted from failure messages, and
  kept in full only in `acceptance/subjects.log`, which git ignores.
- `catalogue.mjs --refresh` writes a placeholder for every other player
  the audit saw and drops a set naming any other tag, so a refresh cannot
  bring a real tag back. A test pins that the committed catalogue names
  none.

Nothing a person sees changes; no contract move. Git history still holds
the earlier catalogue.
