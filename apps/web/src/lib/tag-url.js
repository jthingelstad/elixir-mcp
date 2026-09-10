/**
 * CR tags in the address bar, in one place.
 *
 * A tag is canonical WITH the hash everywhere else in the system — the
 * database, the API, the contract's normalizeTag. A URL is the one place
 * it must not be: `#` starts a fragment, so it has to travel as `%23`,
 * and `/explore/player/%2320JJJ2CCRU` is what a person then copies out
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
