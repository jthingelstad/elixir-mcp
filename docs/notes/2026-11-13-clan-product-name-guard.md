# 2026-11-13 — Clan is named as a part of Elixir, with a guard

Clan is a set of features inside Elixir, never a separate product or an
integration (Jamie, 2026-11-12), and a refactor is finished with a guard
against the old shape (Jamie, 2026-11-13). The last places that still
named "Elixir Clan" as a product, or Clan as an app of its own, say Clan.

- **Discord.** The line Elixir posts when leaders connect a clan's
  activity channel links "Clan in Elixir" (was "Elixir Clan"). Same
  channel, same moment, same words otherwise.
- **Mail.** Clan's morning mail records its sender label as "Clan" (was
  "Elixir Clan"). The label is stored with each send and read by
  nothing; no subject, recipient, schedule or rendered word changes. The
  stored source key `elixir-clan` stays: it is an identifier.
- **Docs.** "Bring your clan" no longer asks you to sign in to Clan again
  after verifying: Clan reads Elixir's session and checks your player on
  every request, so you come back to it.
- **Comments and test data:** the attested facts registry, the wake, the
  activity settings, where Clan's links point, the player page's clan
  read, the Actions tests' sample message.

**The guard.** `docs/no-clan-product.test.mjs` fails when "Elixir Clan"
or "the Clan app" / "Clan's app" appears in the app, the site and its
docs, any package's or service's source or fixtures, or the product
briefs. Dated history (change notes, the notes archive, What's new,
contract change files, migrations) and Jamie's quoted approval lines keep
their words.

Left as they are: Jamie's quotes in `docs/DECISIONS.md`, the product
brief and two code comments; the stored source keys `elixir-clan` and
`clan.poapkings.com` on attested facts and mail issues; the history of
the old standalone secret in `docs/SECRETS.md`.

No behaviour, MCP contract or JSON API change.
