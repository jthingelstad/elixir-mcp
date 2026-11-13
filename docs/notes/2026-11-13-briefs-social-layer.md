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
- **Code over ledger, where they differed:** see Jamie's answers below.

Docs only: no code, contract or migration changes, and nothing deploys.

## Jamie's answers, the same day

- **"Drop can stop writing now."** New DECISIONS line "Drop only signs in
  and reads". The code still has Drop's write paths (an alt claim through
  `POST /api/v1/me/players`, personal records through
  `POST /api/v1/players/{tag}/facts`); they leave in their own change,
  after Drop stops calling them.
- **"Leave Clan actions in the bell."** "Clan's Actions are notifications
  and timeline items" becomes "Clan's Actions are bell notifications":
  Actions are not timeline items, which matches the code.
