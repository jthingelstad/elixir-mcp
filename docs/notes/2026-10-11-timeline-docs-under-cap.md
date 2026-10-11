# 2026-10-11 — The timeline docs page fits one result again

No contract change. The 11.11.1 deploy's acceptance failed four cases
(gym 273.1, 273.2, 273.4 and `catalogue/elixir_timeline#docs`):
`elixir_docs {"page":"timeline"}` was `result_too_large`, 48,217
characters against the 48,000 cap. Two changes the same day each grew
the page and each fit alone: the 11.11.0 facts (#482) and the Discord
delivery notes (#483).

- The page is about 850 characters shorter. #482's own additions are
  shorter, and the kinds table no longer repeats `battle_session`'s,
  `session_standout`'s and `week_resolved`'s facts keys, which the
  facts table lists.
- `packages/tools/test/docs-size.test.mjs` reads every page through
  `elixir_docs` and fails `npm run verify` when one is within 500
  characters of the cap (the served meta is about 250). A page that
  grows past that is trimmed or split in the change that grows it,
  never at deploy.
