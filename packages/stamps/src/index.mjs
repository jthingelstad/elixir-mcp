/**
 * @elixir-mcp/stamps: Passports and Stamps (#1015).
 *
 *  - catalog.mjs (`@elixir-mcp/stamps/catalog`): the definitions, ladders
 *    and profile steps; pure data, safe for the web app to import.
 *  - eligibility.mjs (`@elixir-mcp/stamps/eligibility`): pure evaluation
 *    of a snapshot at an explicit now.
 *  - projection.mjs (`@elixir-mcp/stamps/projection`): the public
 *    passport's whitelist.
 *  - store.mjs: the only reader and writer of migration 0269's tables.
 *  - earn.mjs: the hooks' settle, a ladder fact with its action, and the
 *    owner's bounded reconciliation.
 *
 * The root re-exports only what the web API calls (knip holds it).
 */
export {
  ensurePassport,
  readOwnerPassport,
  readPlayerPassport,
  readPublicPassport,
} from "./store.mjs";
export {
  earnFact,
  reconcilePassport,
  rewindPlayed,
  settlePassport,
} from "./earn.mjs";
