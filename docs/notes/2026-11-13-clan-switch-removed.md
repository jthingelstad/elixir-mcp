# 2026-11-13 — Clan's switch removed

Clan is a set of features inside Elixir, never a separate product
(Jamie, 2026-11-12), so the switch that could turn it off is gone, with
every "off" branch. Production ran with it on; the "on" branch of each
conditional is now unconditional.

**The stack.** `infra/template.yaml` loses the `ClanInternal` parameter,
the `HasInternalClan` condition, the `CLAN_INTERNAL` variable on the web
API, migrate and jobs functions, and the condition on
`ClanEvaluateRule` and `ClanEvaluatePermission`. Its 26 list `Fn::If`s
(IAM statements in the web API, jobs, timeline-sync and email-relay
roles, and three outbox notifications) and four `CLAN_MODEL_SECRET`
`Fn::If`s are collapsed to what they gave with the switch on;
`HasDiscordLogin` keeps its two other terms. `infra/scripts/parameters.mjs`
no longer preserves the parameter, so the deploy stops sending it: an
update that carries a parameter the template does not declare fails.

Checked by resolving both templates (before with the switch on, after
as is) with production's condition inputs, resource by resource: all 20
IAM roles and policies, the outbox bucket's notifications and every
output resolve identically, under either value of the Discord sign-in
switch. The only differences are the removed variable on three
functions: an in-place configuration update for the migrate and jobs
functions, and a new web API revision, which every web API code change
makes. No logical id or replacement-only property changes.

**The app.** `/api/me` no longer carries `features.clan_internal`, and
nothing reads it: Clan's links, the player page's Clan tab and search's
clan rows were gated on it. Clan's own `useNav` is gone; Clan moves on
the app's one (`useNav` in `apps/web/src/App.jsx`), which lost its
page-load detour for a Clan address. The app's router reads a query
string as JSON where it can, so Clan's query readers take the text as
typed (`searchText`: a roster search for `2089` stays `2089`), and the
policy link's fragment rides in the address. The sign-in page forwards
a signed-in reader only from the sign-in address: with Clan now a
client navigation, it stayed drawn while Clan's chunk loaded, ran again
and sent the reader Home.

**Code.** The web API always builds Clan's adapter and registers its
routes; the jobs function always runs `clan_evaluate`; the Clan OAuth
client retirement op (`{family_clients: {retire_app}}`) checks only the
import digest.

**Guard.** `docs/no-clan-switch.test.mjs` fails if any of the switch's
names reappears outside dated notes and `docs/NOTES.md`.

**Left.** `{family_clients: {retire_app}}`, the `clan_state_import`
table it reads and the Clan family OAuth client it retires are still
the separate Clan's last trace; they go together, once the retirement
is known applied in production.

No MCP contract or `/api/v1` change.
