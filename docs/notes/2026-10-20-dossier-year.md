# 2026-10-20 — A draft's dossier tells war weeks from the last year only

A Codex review of #607 found that the member dossier's war weeks were
bounded only by count: the clan's last 52 finished weeks. A clan that
skipped wars, or a gap in the record, let those 52 reach back more than
a year, though the public docs (`clan-actions.md`) say a draft is told
the war weeks "over the last year".

`dossierWar` in `packages/syndication/src/story-facts.mjs` now keeps a
week only if it is among the clan's last 52 finished weeks and it closed
in the 365 days before the draft. The close time is `war_week.closed_at`,
or `finished_observed_at` when that is empty. A week with neither is
left out, because nothing shows it is in the year. `ago` still counts
every finished week back from the newest, one with no close time
included, so a week's distance from the newest does not change with
what is told.

The DECISIONS line on the clan's model now says "over the last year"
too. The stage 2 note (`2026-10-20-draft-dossier-and-angles.md`) said
"the clan's last 52"; this note corrects it, and the year bound is an
[engineering] window like the others.

Pinned by a scratch-database test in
`packages/syndication/test/story-dossier.test.mjs`. It has six weeks:
two from 2025 after a year-long gap, one known only by
`finished_observed_at`, and one with no close time. The old query fails
it.

No contract change: MCP 11.13.1 and JSON API 3.2.0. No migration. No
What's new entry: the code now does what the docs already say.
