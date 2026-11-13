# 2026-11-13 — Clan's last separate-product words

Jamie, 2026-11-12: "Clan is just a set of features INSIDE of Elixir. If
there is any remnant of Clan being separate and an 'integration' that
should be changed." The earlier rounds moved the code; this one takes out
the words that still described Clan as a product of its own.

**Words.**

- "Elixir Clan" as a product name is now "Clan" in the operations guide,
  the email guide, code comments (feedback, UI kit, record, migrate ops,
  the web API's feedback route), test titles and comments, the Discord
  bot's entry on the family page and `.prettierignore`.
- "Door 3" (the 2026-09-25 name for Clan sharing what the clan did with
  Elixir) is gone from Clan's server, client and tests: it is "what the
  clan records in Elixir".
- The OAuth routes' comments name Drop as the family's provisioned
  client; Clan uses Elixir's session.
- The JSON API's person routes and `clans:read` read say who calls them
  now (a family app, a clan's website); Clan's morning run reads in
  process.
- The integrations brief's open item says Clan's morning run already
  moved inside Elixir (JSON API 4.0.0).
- `infra/template.yaml`: two comments only. The web API's
  `email_compose_failed` filter comment now says its one writer, the
  JSON API's clan mail door, is gone, so nothing writes that line to the
  web API's log group today. The filter itself is unchanged.

**DECISIONS.** "A shared highlight posts in its clan's Discord by its
owner's act" now records Jamie's agreement (2026-11-12, "3 - agree with
those") to two defaults the code already has: deleting a highlight
leaves its Discord post in place (`deleteHighlight` touches only
`battle_highlight`), and "Shared highlights" starts off until a leader
turns it on (`activityPolicy` defaults `highlights: false` with or
without a policy). No standing line still described Clan as separate.

**Left as they are.**

- Stored values and labels: the mail's `app: "Elixir Clan"` label and
  `elixir-clan` source, test data strings, fixtures.
- Jamie's quoted words that say "Elixir Clan" (product brief, DECISIONS,
  code comments that quote an approval line).
- Dated notes, What's new entries, contract change files, `docs/NOTES.md`
  and the history in `docs/SECRETS.md`.
- `packages/syndication` (the Discord lane is its own round): a comment
  in `wake.mjs` and the "[Elixir Clan]" link text in the activity
  channel's start message in `clan-settings.mjs`.
- `infra/template.yaml`'s `ClanInternal` parameter, `HasInternalClan`
  condition and `CLAN_INTERNAL` variables (a switch that can turn Clan
  off), and the now writerless `WebApiEmailComposeFailedFilter`: changing
  either is a stack change, not a word.

No behaviour, MCP contract or JSON API change.
