# 2026-10-24 — Connect Discord, and sign in with it (#531)

Jamie, 2026-10-24: "Approved: build Discord linking and sign-in for
#531 in elixir-mcp, with product calls 1-4 as recommended". The
rulings are a DECISIONS line ("A linked Discord tells an agent who is
asking").

**What.** A person connects one Discord account on Profile and can then
sign in with it. With none connected, a Discord sign-in reaches the
account of the address Discord reports verified (opening it when new)
and connects it; with no verified address, the person signs in by email
first. An agent's `on_behalf_of: "discord:<id>"` resolves through the
link to the person's primary, else an alt, that is a current member of
a clan the agent acts for; otherwise its own `elixir_identify` mapping
stands. `meta.asker` says which, and whether the claim is verified.

**How.** Migration 0233: `account_discord` (the Discord user id and
username, one per account and unique) and `discord_login` (one round
trip: a random state, bound to the browser by a cookie nonce and, to
link, to the session that asked; single use, ten minutes, purged a day
after by the jobs sweep). The web API has no internet, so the callback's
code goes to the relay as a sealed object in the outbox
(`discord-login/request/`, on the sign-in mail queue); the relay claims
it once, trades it with Discord (`identify`, plus `email` for a sign-in),
reads the user, revokes the token and writes the sealed reply the
callback waits up to 12 s for. The seal is the clan sealing secret under
its own purpose (`discord login v1`). Nothing Discord gives is kept but
the id and username. `{account_remove}` deletes both tables' rows.

**Off until configured.** `DiscordClientId` and `DiscordSecretInSecret`
(with Clan internal) make `HasDiscordLogin`; without it the routes
answer `?discord=unavailable`, `/api/me` says `discord_login: false`
and the Console shows neither button. Jamie's setup steps are
docs/SECRETS.md, "Discord client secret".

**Engineering defaults.** A Discord sign-in subscribes to product news
only through the form's box, as the email form does. An account already
connected to a different Discord keeps it (`?discord=other`). The
privacy page is unchanged here: its paragraph is Jamie's (the setup
issue carries a draft).

**Not yet.** `elixir_identify` and the Discord agent's `link_me` are
removed last, in an MCP major, once members have connected (call 4;
its own issue). The OAuth authorize page for family apps does not offer
Discord yet.

MCP 11.14.0; JSON API 3.3.0 (the shared `meta` schema lists `asker`, which only an agent's MCP call carries); migration 0233.
