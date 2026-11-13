# 2026-11-13 — Clan's old OAuth client is removed by one op, with a guard

Clan once signed people in to Elixir as a separate app, through a
provisioned family OAuth client (0185, app `clan`). Clan has used
Elixir's own session since it moved inside Elixir, and Clan is a set of
features inside Elixir, never a family app or an integration (Jamie,
2026-11-12). This removes what was left of that client.

**The op.** `{family_clients: {retire_app: {app: "clan",
expected_client_id, apply}}}` no longer asks for a Clan state import
digest. The import step it waited on is finished, and its receipt table
goes in its own change. It still previews by default. With `apply: true`,
in one transaction, it:

- expires the registration
- burns any unused codes
- revokes each live grant, with the usual `connection_revoked` line in
  that account's history (no mail)
- **deletes the `family_oauth_client` row for `clan`**

The expired `oauth_client` row stays as the history of its grants. Run
again once the row is gone, it answers `already_removed` and writes
nothing. Drop's client is refused, as before.

**Provisioning refuses `clan`.** `{family_clients: {provision: {app:
"clan", ...}}}` now fails with "Clan is part of Elixir, never a family
app".

**Tests.** Two tests provisioned a Clan family app with Clan's old
callback (`/api/clan/auth/callback`) only to exercise generic family-app
behaviour. They now use a neutral test family app: the consent test's
second app, and the attested-facts test's no-fact-doors check. The
registration test still refuses "Elixir Clan" as a client name, because
that name impersonates the family.

**The guard.** `docs/no-clan-product.test.mjs` now also fails when:

- any file outside the op, its tests and its catalogue row names a
  family client with app `clan`
- the app, the site, or any package's or service's source names Clan's
  own sign-in route

**For the operator.** The stored row goes only when Jamie's operator runs
the op: preview first, then apply with the client id the preview names.

Left as they are:

- the `elixir-clan` integration account Clan's morning run attests its
  facts as
- the stored fact sources `elixir-clan` and `clan.poapkings.com`
- the `WebApiEmailComposeFailedFilter` metric filter in
  `infra/template.yaml`, which nothing writes since Clan's mail moved to
  the jobs Lambda. It is a stack resource, and removing one is out of
  this change's scope.

No behaviour, MCP contract or JSON API change.
