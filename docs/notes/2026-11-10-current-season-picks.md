# 2026-11-10 — A leaders' pick in the current season

Jamie, 2026-11-10: "Approved: allow leaders' picks in the current open
Elixir Clan season, announcement Action raised immediately".

**Before.** `grant` in `packages/clan/src/manage/awards.mjs` refused
`409 season_not_closed` unless the latest awards snapshot held the season
closed and complete, and **Awards** showed the grant control only there.
A pick is a hand grant keyed by season, award and player; standing and
the removal clock never read grants, so nothing else depended on the
season having closed (product brief `docs/product/clan.md` principle 7,
"leaders' picks stay flexible"; DECISIONS "Manual grants stay flexible").

**Server.** `pickSeason(seasons, id)` is the one rule: `"closed"` for a
closed season the record holds whole, `"current"` for the newest recorded
season while it is open, otherwise null. A future season (not in the
record), an older season still open (a week with no recorded finish) and
a closed season held only in part are refused with the renamed error
`409 season_not_pickable`. Computed awards are untouched: the engine only
writes them at close. `manageView` adds `picks_open` to each season so the
page uses the server's rule rather than its own.

**Announcement.** A grant already called `announceSeason` for its season;
with announcements on, a current-season pick now raises its "Announce
season awards" Action at once. The card's evidence carries
`in_progress: true`, its line says "in progress", and the Action card says
the season is still being fought and that its other awards get their own
announcement at close. At close the existing receipt bookkeeping holds:
the season's announcement names only grants no completed (`done`) card's
`grant_receipts` carry, so a sent pick is not named again. A pick whose
in-progress card is still pending is withdrawn and folded into the
season's own copy (the pending-part match now includes `in_progress`, so
a closed season never keeps an "in progress" card). A take-back in the
current season reads the snapshot to keep the flag. A declined
in-progress card does not stop the pick appearing in the close copy: it
was never sent, and a declined card only suppresses copy of the same
season state (`in_progress` compared, as for pending parts), so a clan
whose only award is a pick still gets its close announcement.
**[engineering]**

**Drafting.** "Draft in our voice" on an in-progress announcement tells
the model the season is still being fought and that the leaders granted
the pick just now (`clan-engine/context.mjs` `actionLines("awards")`
reads `in_progress`); a closed season's copy is told it closed, as before.

**Copy.** The announcements setting reads "When awards are granted …: a
season's awards when it closes, and a leaders' pick as soon as it is
granted." The page's in-progress lede, the picker's note and confirmation,
the error text and "How awards work here" say a pick can be granted while
the season is fought. Public docs: `clan-awards.md`, `clan-actions.md`.

**Tests.** `packages/clan/test/awards.test.mjs`: the refusal test now
allows 136 (current) and refuses 137 (future) and 134 (unseen); new cases
refuse an older open season and a closed partial one, announce a current
pick at once and not again after close, fold a pending pick into the
close copy, and announce a pick-only season at close after its
in-progress copy was declined. `clan-engine/test/context.test.mjs`: the
in-progress drafting context. Playwright (`awards-readiness.spec.ts`): a current-season
grant, and no control when `picks_open` is false.

MCP 11.18.6 and JSON API 3.4.0 unchanged; no migration.
