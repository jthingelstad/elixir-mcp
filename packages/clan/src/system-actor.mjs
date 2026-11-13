/** Elixir Clan's morning run, as the actor its reads are made under.
 *
 * Not a principal: no account, no token, no tier, no quota. It is neither a
 * user, an agent nor an integration ("No integrations: Elixir has users and
 * agents", Jamie, 2026-11-13); it is Elixir acting for itself, inside
 * Elixir. Its name is the one the clan engine's action log already gives
 * system entries (`SYSTEM` in @elixir-mcp/clan-engine/actions.mjs) and the
 * source key Clan's facts and mail carry (ELIXIR_CLAN_SOURCE).
 *
 * Only the jobs runtime hands it to the invoker. No door can construct it:
 * a door's principal is read from an account row, whose kind is never
 * "system". Writes take no actor at all (writeClanFactAsClan,
 * sendClanMailAsClan).
 *
 * - accountId null: the audit row is under no account, principal_kind
 *   "system" (0255); a nickname join finds nothing, as it did before.
 * - firstParty: a live read spends nobody's quota; the fleet's global rate
 *   budget still governs every fetch.
 * - role "member": no elevated tier is implied. */
import { ELIXIR_CLAN_SOURCE } from "@elixir-mcp/contracts";

export const CLAN_SYSTEM_ACTOR = Object.freeze({
  kind: "system",
  name: ELIXIR_CLAN_SOURCE,
  accountId: null,
  role: "member",
  firstParty: true,
});
