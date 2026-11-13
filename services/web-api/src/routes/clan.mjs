/**
 * Clan's routes, ordinary entries in the web API's route table
 * (2026-11-13): the same JSON answers, deadline, one line per request and
 * error handling as every other route. Clan is a part of Elixir, not a
 * door of its own (Jamie, 2026-11-12). The addresses are the ones Clan
 * always had, under /api/clan; mail links to them.
 *
 * Every route but the health check signs a person in first, and a state
 * change needs the contract header, as every web API write does. Who may
 * read or change what is then Clan's own (the gate, the roles, the
 * leader checks), and how a request holds the clan's lock is the request
 * adapter's (`../clan.mjs`, `clanLockPlan`).
 */
import { json } from "../http.mjs";

/** The health check: a liveness answer that reads nothing, so it takes no
 *  database lease and stays an answer when the pool is full. */
const health = Object.assign(() => json(200, { ok: true }), {
  withoutDatabase: true,
});

/**
 * Clan's one answer that needs no sign-in (#526). Everything else is
 * resolved to a person first, so an unsigned exception is added here or
 * nowhere; the public-boundary test pins this list.
 */
export const CLAN_UNSIGNED = Object.freeze({ "GET /api/clan/health": health });

/** Clan's signed-in routes. `/api/clan/clans/<tag>/...` is one family
 *  (`/**`): a clan's pages, its Actions, awards and settings, dispatched
 *  by Clan's handler, which names the exact route in the request's line. */
const SIGNED_IN = [
  "GET /api/clan/me",
  "POST /api/clan/select",
  "POST /api/clan/verify-notice",
  "GET /api/clan/roster",
  "GET /api/clan/directory",
  "GET /api/clan/me/place",
  "PUT /api/clan/me/place",
  "DELETE /api/clan/me/place",
  "GET /api/clan/clans/**",
  "POST /api/clan/clans/**",
  "PUT /api/clan/clans/**",
  "DELETE /api/clan/clans/**",
  // Any other path under /api/clan still signs a person in first, so a
  // signed-out caller learns nothing from which paths exist; Clan answers
  // a signed-in one 404.
  "GET /api/clan/**",
  "POST /api/clan/**",
  "PUT /api/clan/**",
  "DELETE /api/clan/**",
];

/** `clan` is the request adapter (`createClanRequest`); null = Clan is
 *  off (`ClanInternal`), and none of its routes exist. */
export function clanRoutes({ clan, resolvePerson }) {
  if (!clan) return {};
  async function signedIn(db, event, body) {
    const method = event.method ?? "GET";
    const person = await resolvePerson(db, event, {
      requireContractHeader: !["GET", "HEAD"].includes(method),
    });
    if (!person) return json(401, { signed_in: false });
    return clan({
      db,
      account: person,
      event: { ...event, body: event.body ? JSON.stringify(body) : undefined },
    });
  }
  return {
    ...CLAN_UNSIGNED,
    ...Object.fromEntries(SIGNED_IN.map((key) => [key, signedIn])),
  };
}
