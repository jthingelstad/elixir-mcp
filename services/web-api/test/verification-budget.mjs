/** Explicit cost of the approved website proof metadata: at most one new
 * batched lookup per response, independent of how many players it contains.
 * Existing game-record query ceilings and plan/buffer checks stay in place. */
export function verificationBudget(body) {
  return Object.hasOwn(body ?? {}, "player_verifications") ||
    Object.hasOwn(body?.body ?? {}, "player_verifications")
    ? 1
    : 0;
}
