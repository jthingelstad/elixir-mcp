/** Display words for values the API keeps as they are (Jamie, 2026-11-05,
 *  A27). The API's `activity`, `comprehensive` and role names stay; a member
 *  page never prints them. */

const SCOPE = {
  activity: "The clan only",
  comprehensive: "The clan and every member",
};

/** What a clan's recording covers. */
export const scopeLabel = (scope) => SCOPE[scope] ?? scope ?? "";

const capitalized = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Leader limits", "Member limits": what a role is called where it sets
 *  an account's limits. */
export const limitsLabel = (role) =>
  role ? `${capitalized(String(role))} limits` : "Your limits";
