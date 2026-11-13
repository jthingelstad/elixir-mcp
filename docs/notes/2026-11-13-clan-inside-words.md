# Clan inside Elixir: dead doors and words

Jamie, 2026-11-12: "it was an early mistake at the very beginning of this
project that I build Clan as a totally independent product. It was a
terrible idea. Clan is just a set of features INSIDE of Elixir. If there
is any remnant of Clan being separate and an 'integration' that should be
changed." The DECISIONS line records it. This round removes the remnants
that were only doors and words; the morning run's integration writer is
the next round.

## Removed

- Clan's retired OAuth routes (`/api/clan/auth/login`, `/auth/logout`, the
  410 `/auth/callback`) and the handler's `/api/clan/auth/*` path branch.
  Nothing linked to them. The only unsigned Clan route is health; the
  rest answer 401 signed out, before Clan's gate.
- Clan's `not_a_person` refusal page. Elixir's session resolution admits
  only approved persons, so a non-person never reaches Clan's gate; a new
  web-api test signs in an agent account's session row and gets 401 from
  `/api/clan/me` and `/api/clan/directory`. The server branch in the gate
  stays as a defence.
- The CloudFront `/api/clan/*` behaviour. It matched `/api/*` field for
  field (origin, viewer protocol, methods, cache, response headers and
  origin request policies, compression, the viewer-request function), so
  `/api/clan/*` now takes the `/api/*` door; `infra-controls` pins that.
- Clan's own feedback pages: `/clan/feedback` and `/clan/maintain` are
  redirects in `apps/web/src/lib/moved.js`, to Settings and Admin
  feedback.

## Words

"Elixir Clan", "family app" and "first-party client", where they meant
Clan, now say Clan or Elixir in the guides, product briefs, public docs,
code comments and tool text. MCP `attested_by.app` reads `Clan` (12.1.1);
the stored `source` keys (`elixir-clan`, `clan.poapkings.com`), the HKDF
domain, secrets, the `/clan` and `/api/clan` paths, the `clan` feedback
area and the package names stay. Past What's new entries and Jamie's
quotes stay as written.

The Actions mail's "And N more" link went to `/clan/<tag>/today`, which
only redirected; it names Feed and goes there.

## Left

- `packages/mail/src/clan-mail.mjs` and the `/api/v1` facts and mail
  doors still speak of a family app: the doors stay, and the morning run
  moves off them in the next round, with its mail proven byte-identical.
- `integration-api.openapi.json` summaries still name "Elixir Clan" as
  a clans:read and facts:write integration; they change with the morning
  run.
