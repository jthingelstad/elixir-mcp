#!/usr/bin/env node
/**
 * SUPERSEDED. Elixir Clan's OAuth client is no longer registered here:
 * Elixir's /oauth/register refuses a client whose redirect URI is on a
 * family origin, and the family's own clients are provisioned by Elixir
 * (0185), never expiring. Clan's is app "clan", with the redirect URI
 * https://elixir.poapkings.com/api/clan/auth/callback, changed with
 * Elixir's operator op
 *
 *   {"family_clients": {"set_redirect_uris": {"app": "clan", "redirect_uris": [...]}}}
 *
 * (Elixir's ops skill; authority Jamie). The client_id stays the stack
 * parameter OAuthClientId. This file only says so.
 */

console.error(
  "register-client.mjs is superseded: Clan's OAuth client is Elixir's provisioned family client (app 'clan'); see this file's header.",
);
process.exit(2);
