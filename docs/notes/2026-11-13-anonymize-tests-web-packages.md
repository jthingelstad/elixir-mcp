# 2026-11-13 — Hand-written tests carry invented tags (web and packages)

The third step after `2026-11-13-anonymize-bites.md`: every tag in the
hand-written tests of `apps/web` and thirteen packages (tools, ui,
syndication, contracts, claims, auth, collector-door, feedback, ledger,
clan-state, ingest, clan-engine and clan) now comes from the same
mapping, including the ones that already looked
invented, so the guard can become absolute. The `apps/web` sign-in and
follow screens' placeholder tags moved with them, since the journeys type
against them. Clan's suite moves with clan-engine's shared fixture, and so
do the three other tests that read it (clan-web's season view, migrate's
`clans_my_view`, web-api's clan lock). The rest of the services and
clan-web follow in their own change.

The anonymizer learned the shapes tests build from a tag:

- with `{ bare: true }` (any test file), a tag the file writes with its
  `#` also moves where the file writes it bare in a path, a query or a
  no-space list (`/home/player/BODY`, `BODY,BODY`), and with its `#`
  even when the body is all hex. A body of digits only moves only after
  a `/`, and a list item needs a letter, so `9,000` and `/6,000/` stay;
- `--bare-all` treats every tag the run replaces as declared, for a suite
  that declares a tag in one file and builds paths from it in another
  (the e2e clan journeys).

Three tests built tags from a template (`#BODY${i}`); their prefixes now
start `#0` by hand. The tag normalizer's test keeps a lower-case input
with its leading zero written as O. One claims test read rows in tag order and now sorts
its expectation the same way. Nothing a person notices changes; nothing
to deploy.
