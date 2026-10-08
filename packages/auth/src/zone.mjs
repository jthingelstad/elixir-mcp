/**
 * The one check an account's time zone passes, wherever it is set:
 * Profile (`POST /api/me/timezone`) and a new account's signup, which
 * carries the asking browser's zone (Jamie, 2026-10-08). Empty or "UTC"
 * is the default and stores null; a zone this runtime's Intl knows is
 * stored as given; anything else answers undefined, which Profile
 * refuses and signup drops (the account stays on UTC).
 */
export function accountZone(value) {
  const tz = String(value ?? "").trim();
  if (tz === "" || tz.toUpperCase() === "UTC") return null;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
}
