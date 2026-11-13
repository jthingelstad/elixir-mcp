# 2026-11-13 — Hand-written tests carry invented tags (services and the rest)

The last of the hand-written tests after
`2026-11-13-anonymize-tests-web-packages.md`: every tag in the tests of
the services (web-api, migrate, jobs, mcp, scheduler and the rest),
clan-web, record and acceptance's own unit tests now comes from the same
mapping, with `--bare-all` across each suite. The three product
placeholders left (Clan's Scout box, the nickname tool's example, the
UI kit's Tag example) moved with them, since tests read them.

By hand: five expectations read rows in tag order and now sort the same
way (the follow-plan route, two enrolment checks, the 0208 baseline
check, which is about which rows are marked, not their order); the
masked-tag and crest expectations take the new tags' first characters.
What remains in the baseline is the gym and its 48 coupled bites, and a
few docs. Nothing a person notices changes; nothing to deploy.
