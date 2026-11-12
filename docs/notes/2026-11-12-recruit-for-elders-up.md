# 2026-11-12 — Recruit and Scout are leaders' and elders' tools

Jamie's ruling of 2026-11-12, recorded in DECISIONS as "Members is one
page; members keep Standing, and Recruit and Scout are leaders' and
elders' tools" (PR #816). G6 had moved Recruit's copy into Spread the
word for every member (A11); this change takes it back to elders and up.

- **Server first.** `GET /api/clan/clans/<tag>/recruit` answers 403
  `elders_only` unless the reader is a verified elder, co-leader or
  leader, before any live read is spent. Saving the pitch, drafting it
  with the clan's model and forcing a refresh stay the leader's and
  co-leaders', as before. Scout's `POST /scout` already refused anyone
  below elder; it now reads the same `eldersUp` check, and a test pins
  both refusals (`packages/clan/test/recruit.test.mjs`).
- **The page.** Spread the word's Recruit part shows only for a verified
  elder and up. A member keeps the active-policy lines (the tag, the
  clanmates line, the link); with no active policy a member has no foot.
  The small-clan card's **Open Recruit** shows only for elders and up, so
  no member is sent to a refusal. A member who follows Recruit's old
  address (`/members/recruit`, `?show=recruit`) gets its role line, as at
  Scout's, and the page makes no read.
- **Unchanged:** Standing, and the policy switch `members_see_standing`
  and its default; what Scout shows; who writes the pitch.

Docs: Bring your clan and The leaders pages. MCP and JSON API unchanged.
