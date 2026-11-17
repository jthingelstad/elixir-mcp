/**
 * Badge art (2026-11-17, the owner: "Yes use badge art. For sure."). A
 * profile's badge carries `iconUrls.large`, one image per badge and
 * level (cr-agent-api-docs, models/players.md). Like card art it is
 * Supercell's, served from Elixir's own origin as a byte-identical copy
 * (infra/scripts/mirror-card-art.mjs), never hotlinked and never
 * altered: a surface sizes it with HTML or CSS only.
 *
 * The file is named by the icon URL's own opaque id, so one image is
 * one file whichever badges share it, and the name holds no character
 * a path cannot (badge names can hold a space).
 */
import { ELIXIR_ORIGIN } from "./battle-link.js";

const ICON =
  /^https:\/\/api-assets\.clashroyale\.com\/playerbadges\/\d+\/([A-Za-z0-9_-]+)\.png$/;

/** The mirrored file's path on Elixir's origin for one badge icon URL,
 *  or null for a URL the mirror does not copy. */
export function badgeArtPath(
  iconUrl: string | null | undefined,
): string | null {
  const id = typeof iconUrl === "string" ? ICON.exec(iconUrl)?.[1] : undefined;
  return id ? `/assets/badges/${id}.png` : null;
}

/** The art a badge response carries: an absolute URL on Elixir's
 *  origin, or null. */
export function badgeArt(iconUrl: string | null | undefined): string | null {
  const p = badgeArtPath(iconUrl);
  return p ? `${ELIXIR_ORIGIN}${p}` : null;
}
