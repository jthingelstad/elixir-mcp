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
 *
 * The root re-exports what the web API reads today; the store's writers
 * (ensurePassport, grantStamps, recordFact, latchProfile, readSnapshot)
 * join it when the hooks of the next slice call them.
 */
export { readOwnerPassport, readPublicPassport } from "./store.mjs";
