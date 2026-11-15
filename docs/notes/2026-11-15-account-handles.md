# Account handles, and You opens your account page

Jamie, 2026-11-15: "the accounts should have a username for them… and when
you tap "You" it should go to your account, not your primary player".
Approved as recommended: "build account usernames in elixir-mcp as
recommended (unique optional @handle, public on the account page, follow
lists and Find, not MCP; DECISIONS privacy line amended), and make You open
your account page".

## What was built

- `account.handle` (0278): 3 to 20 of `[a-z0-9_]`, unique where set (a
  partial unique index), with `handle_set_at`. Removing an account clears
  it.
- `services/web-api/src/handle.mjs`: normalizing (trim, one leading @,
  lowercase), the reserved words (Elixir's own and staff-sounding ones),
  a short blocked-word list matched anywhere with `_` and digits ignored,
  the suggestion from the main player's name (with a number when taken),
  set and remove (the unique index settles a race as "taken"), handles for
  verified follow-list entries, and prefix search.
- Routes: `POST /api/me/handle` (people only, contract header, 20 writes an
  hour), `GET /api/me/handle-check`, `GET /api/accounts?q=` (search, on the
  account-page budget), `GET /api/accounts/@handle` (the page by handle),
  `POST /api/admin/accounts/handle-clear` (logs `handle_cleared`, which the
  bell says). `/api/me` carries `handle`.
- Web: Settings › Profile's handle field (live check, suggestion, Save
  handle, Remove); the account page header leads with `@handle` and the
  main player under it; `/home/@handle` (route `/home/@{$handle}`); the
  search sheet's Accounts group; `@handle` beside a verified entry in a
  player page's follow lists; Admin's account record shows the handle with
  Clear handle.
- You (`/home/you`) is your own account page (`AccountView`) with Your stats,
  then your account rows (passport, Settings, add or verify, Drop, Admin,
  sign out). Your own account page, by id or handle, marks You in the bar.
  Stats' tabs are You and Stats. PlayerView lost its You-only props.

## Engineering calls

- [engineering] Never in MCP: `players_follows` (packages/tools) is
  untouched; handles are added only in the web player route. The bell
  still names followers by their verified player.
- [engineering] A claimed (unverified) follower shows no handle: anyone can
  claim a tag, and a claim may be held by several accounts.
- [engineering] The blocked list is our own short list, not Supercell's
  chat filter (no copy of it exists here). Admin's clear is the backstop.
- [engineering] Handles are lowercase only; display is `@` plus the key.
