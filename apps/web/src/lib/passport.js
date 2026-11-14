import { STAMPS, stampById } from "@elixir-mcp/stamps/catalog";
import { HOME } from "./moved.js";
import { SETTINGS } from "./settings.js";

/**
 * A passport's addresses and the words its pages share (#1015).
 *
 *   /home/passport                 your own passport
 *   /home/passport/<passport id>   anyone's, for any signed-in member
 *   ...?stamp=<stamp id>           the same page, one Stamp's detail open
 *
 * Both sit under /home, which the distribution already sends to this app,
 * behind Home's member gate. `?stamp=` is how a link (the bell's, a shared
 * one) opens one Stamp: an id the catalog does not know opens nothing.
 */
export const PASSPORT = `${HOME}/passport`;

/** Passport ids are twelve letters and digits with no look-alikes
 *  (packages/stamps store.mjs). */
const PASSPORT_ID = /^[a-km-np-z2-9]{12}$/;

export const passportHref = (id = null, stampId = null) => {
  const base = id ? `${PASSPORT}/${id}` : PASSPORT;
  return stampId ? `${base}?stamp=${encodeURIComponent(stampId)}` : base;
};

/** At most this many reconciliation passes on one open. Each pass is
 *  bounded on the server and answers `more` when another would read on. */
export const RECONCILE_PASSES = 3;

/**
 * The owner's reconciliation (#1015), shared by the passport page and Home:
 * `call` is one pass (`api.reconcilePassport`), repeated while it answers
 * `more`, at most `passes` times. Quiet: a refusal, a failed call or a
 * thrown error ends the run and is never shown, since the passport already
 * on screen stays true. Resolves to how many passes answered (`read`) and
 * how many Stamps they granted: an answered pass can move progress without
 * granting a level, so a caller reads the passport again after any answer
 * and the bell only after a grant.
 */
export async function reconcilePassport(
  call,
  { passes = RECONCILE_PASSES } = {},
) {
  let granted = 0;
  let read = 0;
  for (let i = 0; i < passes; i += 1) {
    let env;
    try {
      env = await call();
    } catch {
      break;
    }
    if (!env?.ok || env.status !== 200 || !env.data) break;
    read += 1;
    granted += Array.isArray(env.data.granted) ? env.data.granted.length : 0;
    if (env.data.more !== true) break;
  }
  return { read, granted };
}

/** Whether a path is a passport page: yours, or one with a well-formed id. */
export function isPassportPath(path) {
  const clean = String(path ?? "").replace(/(.)\/$/, "$1");
  if (clean === PASSPORT) return true;
  const m = /^\/home\/passport\/([^/]+)$/.exec(clean);
  return Boolean(m && PASSPORT_ID.test(m[1]));
}

/** The passport id a path names, or null for your own. */
export function passportIdOf(path) {
  const m = /^\/home\/passport\/([^/]+)\/?$/.exec(String(path ?? ""));
  return m && PASSPORT_ID.test(m[1]) ? m[1] : null;
}

/** The catalog's groups, in its order. */
export const GROUPS = [...new Set(STAMPS.map((s) => s.group))];

/** Each Stamp's highest earned level, with its day, from a projection's
 *  `earned` list. */
export function earnedMap(earned) {
  const out = new Map();
  for (const e of earned ?? []) {
    if (!stampById(e?.stamp_id)) continue;
    const held = out.get(e.stamp_id);
    if (!held || held.level < e.level) out.set(e.stamp_id, e);
  }
  return out;
}

/** Singular and plural for a ladder's unit, as the levels list says it. */
const UNITS = {
  played_together: ["day", "days"],
  cheerleader: ["day", "days"],
  storyteller: ["highlighted battle", "highlighted battles"],
  inner_circle: ["player", "players"],
};
export function unitWord(stampId, n) {
  const [one, many] = UNITS[stampId] ?? ["", ""];
  return n === 1 ? one : many;
}

/** Where the owner does what earns a Stamp, from its catalog destination.
 *  `clanTag` is the owner's home clan, for the map; without one, Clan. */
export function destinationHref(destination, { clanTag = null } = {}) {
  switch (destination) {
    case "verification":
      return `${SETTINGS}/players/verify`;
    case "picture":
      return `${SETTINGS}/profile`;
    case "map-view":
      return clanTag
        ? `/clan/${String(clanTag).replace(/^#/, "")}/members/map`
        : "/clan";
    case "alts":
      return `${SETTINGS}/players#add-player-tag`;
    case "discord":
      return `${SETTINGS}/connections/discord`;
    case "friends":
      return `${HOME}/find`;
    case "player":
      return `${HOME}/you`;
    default:
      return HOME;
  }
}

/** The compact row's summary from a projection's `earned` list, the shape
 *  the player page's read sends: the count and the two most recent marks
 *  (by day, a legacy grant by the day it preceded). */
export function summaryOf(passport) {
  const earned = [...earnedMap(passport?.earned).values()];
  const dayOf = (e) => e.earned_on ?? e.earned_before ?? "";
  const marks = [...earned]
    .sort((a, b) => (dayOf(b) > dayOf(a) ? 1 : dayOf(b) < dayOf(a) ? -1 : 0))
    .slice(0, 2)
    .map((e) => ({ stamp_id: e.stamp_id, level: e.level }));
  return { id: passport?.id ?? null, count: earned.length, marks };
}
