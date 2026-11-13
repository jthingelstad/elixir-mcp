# 2026-11-13 — The real-tag guard is absolute

The last tags the ratchet tolerated were in a few docs: the operator
skill's `{poll_state}` example, the site's agent, integration, protocol
and response pages, `docs/NOTES.md` and a comment in `cr-api.mjs`. They
now carry invented tags from the same mapping (the comment names POAP
KINGS' tag whole instead of a truncated one). The ratchet started this
morning at 417 files and 4,073 counted tags; it ends at none.

So the baseline is gone (`docs/no-real-tags.baseline.json` and the
helper's `--update`). `docs/no-real-tags.test.mjs` now fails on any file
holding a tag that is not King Thing's, POAP KINGS' or listed in
`docs/invented-tags.json`. The two sha256-pinned migrations (0208, 0210)
keep their counts, fixed as before. AGENTS.md's "Real tags" says the
same, adds names, and says how a new capture is cleaned
(`infra/scripts/anonymize-fixtures.mjs`) and how acceptance names other
players (placeholders). The salt behind tonight's mapping was deleted
once the last pull request that needed it merged; the mapping exists
nowhere.

Nothing a person notices changes; nothing to deploy.
