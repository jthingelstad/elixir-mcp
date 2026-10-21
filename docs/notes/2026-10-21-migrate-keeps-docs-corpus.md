# 2026-10-21 — The migrate bundle keeps the docs corpus

`2026-10-21-web-api-cold-start.md` left the docs corpus out of the jobs
and migrate bundles, on the reading that neither calls a docs tool. Codex
found one that does, in review of #623: migrate's `profile_tool` op
(`services/migrate/src/ops-profile.mjs`) takes any read-only tool that
is not open-world, and `elixir_docs`, `elixir_examples` and
`elixir_updates` qualify. With the stub, profiling one of them returned
`docs_corpus_not_bundled` instead of a profile.

migrate carries the corpus again (`docs: true` in `infra/scripts/build.mjs`),
unsplit as before, so its bundle is back to about 3.5 MB. That costs
nothing that matters: migrate runs during a deploy and for an op, never on
a request. jobs still goes without it; it calls a fixed set of record
tools, none of them a docs tool. `services/mcp/test/lambda-bundles.test.mjs`
now expects the corpus in web-api, MCP and migrate. Build only: no MCP
or JSON API version moves.
