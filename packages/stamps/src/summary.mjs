/**
 * A passport in one row (#1015): what a verified player's page shows of
 * its owner's passport.
 *
 *   { id, count, marks: [{ stamp_id, level }] }   (at most two marks)
 *
 * Built from the public projection, so it can carry nothing the public
 * passport does not: no progress, no profile list, no account id, no
 * place. Reads only: an owner who has never opened their passport has no
 * row yet, and another member's read does not make one (null).
 */
import { passportIdOf, readPublicPassport } from "./store.mjs";

/** The two most recent marks and the count, from a projection's earned
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

/** The summary of an account's passport, or null when it has none. */
export async function readPassportSummary(db, accountId) {
  if (!accountId) return null;
  const id = await passportIdOf(db, accountId);
  if (!id) return null;
  const out = await readPublicPassport(db, id);
  return out ? summarize(out.passport) : null;
}
