import { HOME } from "./moved.js";

/**
 * An account's addresses (Jamie, 2026-11-15).
 *
 *   /home/account/<id>            an account's page, for any signed-in member
 *   /home/account/<id>/passport   its passport (lib/passport.js)
 *
 * <id> is the account's page id, its passport id: twelve letters and
 * digits with no look-alikes, never the account's UUID or an agent's id.
 */
export const ACCOUNT = `${HOME}/account`;

const PAGE_ID = /^[a-km-np-z2-9]{12}$/;

export const isPageId = (id) => typeof id === "string" && PAGE_ID.test(id);

export const accountHref = (id) => `${ACCOUNT}/${id}`;

/** The page id an account page's path names, or null. Its passport is not
 *  the account page. */
export function accountIdOf(path) {
  const m = /^\/home\/account\/([^/]+)\/?$/.exec(String(path ?? ""));
  return m && isPageId(m[1]) ? m[1] : null;
}

export const isAccountPath = (path) => accountIdOf(path) !== null;

/** The account a people item is about (a verified player, a Stamp, a
 *  place: 2026-11-15), by its page id, or null. */
export const accountOf = (it) =>
  it?.section === "people" && isPageId(it.facts?.account_id)
    ? it.facts.account_id
    : null;
