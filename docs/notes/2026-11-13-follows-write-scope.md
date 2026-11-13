# 2026-11-13 — Following's scope is follows:write (12.1.0)

DECISIONS "Follow, never track" [Jamie, 2026-11-12] names the OAuth scope
that adds a follow. 12.0.0 renamed the tools and kept the scope's key;
this renames the key, `recordings:write` to `follows:write`, keeping every
grant and token made under the old name working with no re-consent (the
coordinator's brief, 2026-11-13).

- **One mapping, at every read.** `LEGACY_OAUTH_SCOPES` in
  `packages/contracts/src/tool-groups.ts` maps an old name to its new one;
  `currentScopeNames` in `@elixir-mcp/auth` applies it with the
  `collections:write` drop, and `normalizeScope`, the service-key read, the
  consent form's ticked boxes and the agent keys list all go through it.
  A request for `recordings:write` (Elixir Drop still asks for it) is
  granted `follows:write`.
- **Storage is never rewritten.** 0251 lets the grant shape checks accept
  either name in the same slot (NOT VALID); 0252 validates them in their
  own migration. Rows written before the rename keep `recordings:write`
  and read as `follows:write`. New rows are written with `follows:write`,
  so a code rollback past this change would read those rows as invalid
  scope: roll forward instead.
- **What names change.** Discovery's `scopes_supported`, the consent page,
  token responses and insufficient_scope challenges name only
  `follows:write`; a stored old-name grant's token response now says
  `follows:write` too, which RFC 6749 allows and no family client checks.
  The JSON API's `POST /me/players` names it (3.7.0, a minor).
- **Drop.** Jamie, 2026-11-13: "we should move drop to doing no writing to
  Elixir and ONLY authenticating and getting a verified clash Royale
  account". Drop still asks for `recordings:write` until its own change
  drops it; nothing in Drop changes here.

Pinned by `packages/auth/test/oauth.test.mjs` (a stored old-name grant,
refresh and key keep their authority, and the row is unchanged).
