/**
 * The public passport: the one shape any signed-in member may read for
 * any person account, built field by field from a whitelist.
 *
 *   {
 *     passport: {
 *       id,             the opaque passport id (never the account UUID)
 *       display_name,   the primary player's public game name, or "New player"
 *       player,         { tag, name, verified, avatar_card_id } or null
 *       earned: [{ stamp_id, level, earned_on, earned_before }]
 *     },
 *     catalog_version
 *   }
 *
 * Never in it: email or anything made from one, a nickname, a Discord
 * handle, a city or coordinates, a time zone, the account UUID, tokens,
 * limits, usage, exact unearned counts. The builder copies named fields
 * only, so an extra column on the row it is given cannot leak through;
 * test/projection.test.mjs and the web API's passport test pin it.
 *
 * An unverified primary claim is shown as a claim (verified: false) and
 * never with the profile picture, which is shown on verified players
 * only (0268). No player means display_name "New player" and player null.
 */
import { CATALOG_VERSION, STAMPS, stampById } from "./catalog.mjs";

export const NEW_PLAYER = "New player";

const ORDER = new Map(STAMPS.map((s, i) => [s.id, i]));

const day = (v) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;

/**
 * The highest level of each known Stamp, with that level's day. A legacy
 * grant (backfilled without a trustworthy instant) has earned_on null and
 * earned_before set to the day it is known to precede.
 */
export function publicEarned(rows) {
  const best = new Map();
  for (const r of rows ?? []) {
    const def = stampById(r?.stamp_id);
    const level = Number(r?.level);
    if (!def || !Number.isInteger(level)) continue;
    if (level < 1 || level > def.thresholds.length) continue;
    const held = best.get(def.id);
    if (held && held.level >= level) continue;
    const before = day(r.legacy_before);
    best.set(def.id, {
      stamp_id: def.id,
      level,
      earned_on: before ? null : day(r.earned_on),
      earned_before: before,
    });
  }
  return [...best.values()].sort(
    (a, b) => ORDER.get(a.stamp_id) - ORDER.get(b.stamp_id),
  );
}

/** The public player, from the account's primary claim, or null. */
export function publicPlayer(primary) {
  if (!primary || typeof primary.tag !== "string") return null;
  const verified = primary.verified === true;
  const card = Number(primary.avatar_card_id);
  return {
    tag: primary.tag,
    name:
      typeof primary.name === "string" && primary.name ? primary.name : null,
    verified,
    avatar_card_id:
      verified && primary.avatar_card_id != null && Number.isInteger(card)
        ? card
        : null,
  };
}

/**
 * The public projection from what the store read: { passport_id,
 * primary: { tag, name, verified, avatar_card_id } | null, earned: rows }.
 */
export function publicPassport({ passport_id, primary, earned }) {
  const player = publicPlayer(primary);
  return {
    passport: {
      id: String(passport_id),
      display_name: player?.name ?? NEW_PLAYER,
      player,
      earned: publicEarned(earned),
    },
    catalog_version: CATALOG_VERSION,
  };
}

/** A passport in one row (#1015), for a verified player's page: the
 *  two most recent marks and the count, from a projection's earned
 *  list (each Stamp once, at its highest level). A legacy grant sorts by
 *  the day it is known to precede. */
export function summarize(passport) {
  const earned = passport?.earned ?? [];
  const dayOf = (e) => e.earned_on ?? e.earned_before ?? "";
  const marks = [...earned]
    .sort((a, b) => (dayOf(b) > dayOf(a) ? 1 : dayOf(b) < dayOf(a) ? -1 : 0))
    .slice(0, 2)
    .map((e) => ({ stamp_id: e.stamp_id, level: e.level }));
  return { id: passport.id, count: earned.length, marks };
}
