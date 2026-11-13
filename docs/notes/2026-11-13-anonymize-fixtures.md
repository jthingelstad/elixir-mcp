# 2026-11-13 — Fixtures carry invented players and clans

The ratchet (`2026-11-13-real-tag-ratchet.md`) stopped real tags growing;
this starts taking them out. Many players are minors and the repository is
public, so captured payloads now carry invented players and clans, with
only King Thing and POAP KINGS real.

- `infra/scripts/anonymize-fixtures.mjs` does the mechanical part, once
  per area: every tag the guard counts becomes an invented one of the same
  length starting `#0` (listed in `docs/invented-tags.json`, checked
  against every real tag the guard's commit held), and every player name,
  clan name and clan description captured in the fixtures becomes an
  invented one with the same shape (`infra/scripts/lib/anonymize.mjs`,
  word list `lib/invented-words.json`, tested in `docs/anonymize.test.mjs`).
  One real player is one invented player in every file: the mapping comes
  from a random salt kept outside the repository, so it is never
  committed or printed, and is deleted when the work is done.
- This change: the shared `fixtures/` (14 captured files), the mail
  fixtures and their preview script, and the tests that read them, which
  follow the same mapping. Mail renders the same mail with other names.
- Names are replaced only in captured data and tests; product source and
  docs keep their invented examples.

Nothing a person sees changes; no contract, JSON API or migration change;
nothing to deploy. Git history still holds the captured values.
