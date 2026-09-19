/** The Tinylytics pixel (Jamie, 2026-09-18: opens count, on every kind
 *  including the transactional ones). A 1x1 gif that records an
 *  ordinary hit on the site's Tinylytics - cookieless, nothing kept
 *  about a person - at a path that names the MAIL, never the reader:
 *  /mail/<kind>/<period> for a report or a milestone bundle,
 *  /mail/login and /mail/welcome for the transactional kinds. Image
 *  caching and blocking undercount, which Tinylytics says plainly; the
 *  number is a floor, not an open rate. Same embed code as the site. */
export const TINYLYTICS_EMBED_CODE = "Yzx8dUUvUPn9AEJpTMeU";

export function pixelPath(kind, period = null) {
  return period ? `/mail/${kind}/${period}` : `/mail/${kind}`;
}

export function pixelUrl(path) {
  return `https://tinylytics.app/pixel/${TINYLYTICS_EMBED_CODE}.gif?path=${encodeURIComponent(path)}`;
}

/** The tag itself: sized and styled so a client that shows images
 *  shows nothing, alt empty so a reader hears nothing. */
export function pixelTag(path) {
  return `<img src="${pixelUrl(path)}" alt="" width="1" height="1" style="display:block;width:1px;height:1px;border:0;" />`;
}
