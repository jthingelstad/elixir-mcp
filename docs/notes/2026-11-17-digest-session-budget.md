# 2026-11-17 — The digest's sittings have a budget over the whole mail

Codex on #1084: the deck art was budgeted once a person, but a digest at
its twelve-person cap with three big sittings each rendered 111 to 133 KB
of HTML, past Gmail's ~102 KB clip, which hides the rest of the mail and
its turn-off link.

`digestPeople` in `packages/mail/src/render.mjs` now draws people in
order with one budget for them all (`DIGEST_BUDGET`): a person's
sittings are full, with the deck's art for the first three people, while
the people drawn so far stay under 40 KB; each sitting is one line (its
linked headline, trophies and time) under 60 KB; past that, one line says
how many sittings they had and links their page. A normal week renders
unchanged (the fixture: 28.8 KB, all full). The worst case in
`packages/mail/test/digest-sittings.test.mjs` (twelve people, three big
sittings and three items each, long names) is 84 KB with the footer in.

Render only: the stored issue is unchanged. MCP 13.4.0 and JSON API 5.1.0
unchanged. No migration.
