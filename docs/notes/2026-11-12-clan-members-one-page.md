# 2026-11-12 — Clan's Members is one page; nobody's access changed

G6 of the 2026-11-12 fixes: Clan › Members had a second row of pages
(Roster, Standing, Review, Map; Recruit, Scout) under the tab row. The row
is gone and each page moved where its readers already were, with **no
change to who sees what** (removing a page from members or elders is a
product call, and not made here):

- **Standing** is the first section of Standings, above Awards, for every
  member. Awards under it says its own "too few" or "no policy" in one
  line rather than a second box.
- **Review** is in Run's Actions group (`/run/review`), leaders only as
  before; Run already refuses its address and reads to everyone else.
- **Recruit**'s pitch tools are inside Members' **Spread the word**, at the
  roster's foot, for every member. Recruit's read asks the game for live
  numbers, so the copy mounts on a tap (or `?show=recruit`), never on page
  load. Spread the word's active-policy lines (the tag, the clanmates line,
  the link) moved to the same foot section; the small-clan, set-up and
  invite-the-leaders cards stay above the roster, where they are the next
  step.
- **Scout** sits at the foot of Members for elders and up. Run cannot
  show elders only its Scout entry without opening Run's leader pages and
  reads to them, so the foot was the clean place. Anyone else who follows
  Scout's address (`?show=scout`) gets Scout's role line, not the form.
- **Follow** on every roster row: `FollowMember`, lent by `apps/web`
  through `createClanRoutes` like `FollowClan`, priced by the clan's one
  follow plan (`GET /api/me/follow-plan?clan_tag=`), so one read covers
  the roster and the dialog says the same cost and slot limits as Follow
  everyone (#774). Your own players get nothing; a followed one reads
  "Following". On a phone the row keeps its card grid with Follow in a
  third column, above the row's whole-row link.
- Find a member sits over the roster; the Map and Away have a "‹ Members"
  link back.

Redirects: `clanMoved` sends `/members/standing` to `/standings` and
`/members/review` (and `/manage/board`, `/standing`) to their new homes;
Clan's shell sends `/members/recruit` and `/members/scout` (and through
them `/recruit` and `/manage/scout`) to `/members?show=…`, since what
opens there depends on the session.

The foot sections are flat (a heading and a rule, no box), per Jamie's
"Flat is better".

MCP and the JSON API unchanged.
