# 2026-11-13 — The site build retries its live reads, then fails

On 2026-11-13 a deploy's site build read `/api/public/stats` moments after
the stack switch, met a 503, and baked the corpus page without its totals
(the loader skipped on any failure); smoke then failed on the live page.
The card catalog read had the same stance, and worse: the site phase
publishes with `removeMissing`, so a failed catalog read would have
deleted every card page.

- `apps/site/src/_lib/fetch-public.mjs` reads a public endpoint with five
  attempts and doubling backoff (2, 4, 8, 16 s): a network error, a
  timeout, 429 and 5xx are retried; a 404 or an unparseable body fails at
  once.
- `_data/stats.js` and `_lib/catalog.mjs` (the cards) use it, and a read
  that still fails, or stats with no `totals`, throws: Eleventy exits
  non-zero and `build-site.mjs` fails.
- **What a failed build does to a deploy.** The site phase builds before
  it uploads anything, so the deploy stops there: the code and the stack
  have already switched (the site phase follows them), and the pages
  published by the last good build stay up, totals and card pages
  included. Invalidation, smoke, acceptance and the deploy record do not
  run. Rerunning the deploy takes the site lane (bundles and template
  already match) and publishes the site, then smoke and acceptance run.
  That is better than the old outcome, a live page missing its numbers
  and a red smoke.
- `ELIXIR_SKIP_STATS=1` (`--skip-stats`) still builds offline from the
  fixtures for tests, CI and the e2e journeys; a first `--create` deploy
  with no live endpoint sets it.

No contract or JSON API change; nothing a tool serves moved.
