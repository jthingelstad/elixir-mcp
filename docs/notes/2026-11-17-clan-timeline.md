# 2026-11-17 — Your clan's Timeline

Jamie, 2026-11-17: a player and a clan each have a Timeline, and joins,
departures and other clan activity can matter more on the clan's Timeline
than on the person's main Timeline.

Clan's first tab reads Timeline; its `/feed` address stays. All activity
is the default, newest first, with all the existing activity. Clan news
selects roster arrivals, departures and role changes, race observations
and outcomes, and attested facts whose canonical subject is a clan. The
reader applies that selection before the timeline cap, after the same
permission rules. Its omitted count includes only omitted clan news.
Both views use the same item identities and renderer; changing the view
does not synthesize or duplicate an event. Posts stay in All activity.

The clan head keeps the name, member count, role, roster freshness,
Follow and picker visible. About this clan discloses the tag,
recruitment details, race summary and saved policy chips. Verification
and role notices stay outside it. ActionsNow remains before the
Timeline; the race moves beside it on desktop and below it on phones,
with the existing personal and weekly panels.

This is a signed-in Clan read only. A clan-news classification grants
no new visibility or public sharing permission. Leader-only facts keep
their existing authorization. No changes to a personal Timeline's order,
the policy, holds, leader tools, legal copy, game data, schema or the
public APIs. MCP 13.11.0 and JSON API 5.1.0 are unchanged.

Validation includes failing-before unit regressions for the controls and
disclosure, a database regression proving news is selected before a busy
week's cap, and a mutation check proving omitted member moments are not
counted as omitted news. Browser checks at 320, 390 and 1280 cover the
initial view, keyboard disclosure, server news request, round-trip back
to All, 44 px controls, reduced motion, accessibility, 200% phone text and
no sideways scroll. Screenshots of All, About and News were inspected;
the compact disclosure received a second layout iteration. In that
fixture the first post moved up 174, 154 and 89 px respectively. The
fixture does not supply successful personal or weekly panel responses;
their failure states were visible beside or after activity. No live
member data was written to verify the change.
