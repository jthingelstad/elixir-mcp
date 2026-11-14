/**
 * What no public view of a passport may carry (#1015): the public
 * projection (passport.test.mjs) and the player page's one-row summary
 * (player-passport.test.mjs) are checked against this one list, plus each
 * test's own account id, Discord name and nickname.
 */
export const PASSPORT_LEAKS = Object.freeze([
  "example.com",
  "@",
  "America/Chicago",
  "Chicago",
  "progress",
  "owner",
  "token",
  "limit",
  "usage",
  "timezone",
]);
