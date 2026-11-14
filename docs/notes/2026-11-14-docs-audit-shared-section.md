# 2026-11-14 — The docs audit holds a shared section the same for every tool

The acceptance gate on deploy 68331b22 (the second run that day) failed one
case of 131, `catalogue/battles_opponents#docs`: "battles#what-a-battle-record-holds
documents rounds_played and no response this run, nor any bite of
battles_opponents, carried it". The morning's runs passed 131 of 131 with no
change to `battles_opponents`.

**Cause.** `battles_opponents` answers with `docs:
battles#what-a-battle-record-holds`, the section that describes
`battles_query`'s row. The `#docs` rule is about the section: every field it
names must be on some response this run, from any tool, or failing that on a
committed bite of the tool. The live half is run-wide; the bite half was
per-tool. `rounds_played` is on duel rows only, and `battles_opponents` can
never carry it (an opponent row counts a duel once and has no per-battle
fields). So the case passed only while `battles_query`'s window for King
Thing held a duel. On the failing run it held none: `battles_query#docs`
passed on its own bite (`95-battles_query-duel-false-draw.json`, listed under
docs provenance) and `battles_opponents#docs` had no bite to fall back on. A
bite of `battles_opponents` carrying `rounds_played` would have been a capture
of something the tool cannot serve, so the fix is in which evidence holds the
section, not a new bite.

**Fix.** For `#docs`, a bite of a tool whose answers this run point at the
same section counts as well, and the docs provenance line names that tool
(`battles_opponents#docs rounds_played (battles_query 95-...json)`). A bite
of a tool on another section still lends nothing, and a field that no
response this run and no bite of any tool on the section carried is still
the finding. The notes rule is unchanged (notes are per tool). The same
holds for the other sections several tools share (`freshness-and-gaps`
sections, `recording#the-games-own-last-seen`).

Pinned in `acceptance/acceptance.test.mjs` with invented tools: without the
change the test fails with the production message. No contract change.

A follow-up worth weighing separately: `battles_opponents` points agents at a
section that describes `battles_query` rows, not its own per-opponent rows.
