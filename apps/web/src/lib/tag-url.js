/**
 * CR tags in the address bar, in one place.
 *
 * A tag is canonical WITH the hash everywhere else in the system — the
 * database, the API, the contract's normalizeTag. A URL is the one place
 * it must not be: `#` starts a fragment, so it has to travel as `%23`,
 * and `/console/explore/player/%2320JJJ2CCRU` is what a person copies out
 * of the address bar and pastes into a message.
 *
 * The two halves used to be written per call site, and they disagreed.
 * Explore stripped the hash and put it back; Tracking encoded the
 * canonical tag, so its own links carried `%23` and worked; Overview
 * stripped the hash but the reader did not put it back, so Overview's
 * links to the same page silently found nothing. One tag, three
 * spellings, and the one that 404'd was the one on the front page.
 *
 * So: LINKS CARRY NO HASH, READERS PUT IT BACK. Both halves here, and
 * the reader accepts `%23` too, because bookmarks and pasted links from
 * before this exist and are not the visitor's fault.
 */

/** Tag as it appears in a path segment: no hash, no escaping needed. */
export function tagPath(tag) {
  return String(tag ?? "").replace(/^#/, "");
}

/** A path segment back to a canonical tag. */
export function tagFromPath(segment) {
  const decoded = decodeURIComponent(String(segment ?? ""));
  return decoded ? `#${decoded.replace(/^#/, "")}` : "";
}

/** What a person typed, as a canonical tag: the game's tags have no letter O. */
export function normTag(q) {
  return (
    "#" +
    String(q ?? "")
      .trim()
      .toUpperCase()
      .replace(/^#/, "")
      .replaceAll("O", "0")
  );
}

/** A deck hash, as Explore's lookup and the search sheet read it. */
export const HASH_RE = /^(deck:)?[0-9a-f]{16,64}$/i;
// A war week is Season and Week, the way the game and the rest of this
// console name it: "S135 W3", "s135w3", "S135-W3". It used to accept only
// an ISO calendar week (2026-W36), which nothing else here uses and the
// page's own hint contradicted, so the advertised form fell through to a
// name search and a miss.
// "136-2", "S136 W2", "136w2" (console walk 2: "136-2" was refused).
export const WEEK_RE =
  /^(?:season\s+|s)?\s*(\d{1,4})\s*(?:[-·,]\s*(?:week\s*|w)?|\s*(?:week\s*|w))\s*(\d{1,2})$/i;
