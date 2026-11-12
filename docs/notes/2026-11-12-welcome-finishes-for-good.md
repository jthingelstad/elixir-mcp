# 2026-11-12 — The welcome checklist finishes for good

Jamie ruled on the three `[engineering]` defaults of Home's welcome steps
(`2026-11-12-home-welcome-steps.md`), recorded in DECISIONS "The welcome
checklist finishes for good": one follow completes the follow step;
turning the digest off counts as choosing it; once finished, a stored
flag hides the checklist for good. The first two were already how the
steps read; this change adds the third.

- **Migration 0246** adds `account.welcome_finished_at`, nullable, no
  default (catalog-only; `lock_timeout` 5 s). No backfill: an account that
  has already done all four is stamped on its next Home read.
- **The first answer stamps it** (`services/web-api/src/first-answer.mjs`).
  When its welcome read sees a verified primary player, one follow or more
  and a digest setting of the person's own (off included), and the account
  is not stamped, one conditional `update ... where welcome_finished_at is
  null` stamps it. The write happens once per account, inside a GET
  (`/api/me/home`, `/api/me/first-answer`), and never again; nothing
  clears it. `welcome.finished_at` rides in the answer.
- **Home** (`welcomeSteps` in `apps/web/src/home/logic.js`) treats a
  finished account as all done, whatever its follows or settings read now.

Tested on a scratch database: three of four is not finished; the fourth
stamps it; deleting every follow keeps the first stamp; another account is
untouched. No MCP or JSON API change.
