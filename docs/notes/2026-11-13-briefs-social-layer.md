# 2026-11-13: The product briefs describe the social layer

The briefs in `docs/product/` were ratified on 2026-10-12, a month before
`VISION.md`. This change rewrites them to VISION and the DECISIONS
rulings of 2026-11-11 and 2026-11-12, checked against the code. Each
brief says under its title that the rewrite waits on Jamie's read; until
then VISION and DECISIONS still steer ("VISION steers until a brief is
rewritten").

- **Rewritten:** the record, accounts and privacy, MCP and agents, Home,
  Timeline, Mail, Stats (`ladder.md`, kept at its path), Clan, the JSON
  API and integrations, collectors. The dated banners are gone because
  their content is now in the text.
- **Folded:** `console.md` is a pointer to where the Console's subjects
  live; its Settings principles moved to accounts. `structure.md` stays
  the dated record of the 2026-11-05 redesign, not a brief.
- **Code over ledger, where they differ:** Clan Actions are in the bell
  (`/api/me/home/needs`) and Run, not yet timeline items; Drop still
  adds alt claims and writes personal records as attested facts, though
  Jamie's direction of 2026-11-13 ends that. Both are listed as open in
  the briefs, and no DECISIONS line changes here.

Docs only: no code, contract, migration or DECISIONS meaning changes,
and nothing deploys.
