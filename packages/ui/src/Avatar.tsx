import { useState, type CSSProperties } from "react";
import { avatarCrop } from "./avatar-crops.ts";
import { cardArtSrc, isTowerTroop } from "./Cards.tsx";

/**
 * An avatar (the canvas's .av, 2026-11-13): a name's initials on one of seven
 * fills, chosen from the tag so a person keeps theirs everywhere. Drawn for
 * the eye only: the name beside it is what a reader hears, so it is hidden
 * from the accessibility tree. A clan's is a rounded square with the gold
 * edge.
 *
 * A player's avatar may instead be a picture (2026-11-14): the Clash Royale
 * card an account chose as its profile image, shown on the players that
 * account verified. Never a photo of anyone: the picture is the card's base
 * art, the mirror's own file, placed in the circle by CSS alone (the crop in
 * `avatar-crops.ts`), never resized, re-encoded or filtered. When the art
 * cannot load, the initials come back.
 */
export function avatarInitials(name: string | null | undefined): string {
  const words = String(name ?? "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => Array.from(w));
  const [first, second] = words;
  if (!first) return "?";
  if (second) return `${first[0]}${second[0]}`.toUpperCase();
  return first.slice(0, 2).join("").toUpperCase();
}

/** One of 1 to 7, the same for the same key every time. */
export function avatarHue(key: string | null | undefined): number {
  let h = 0;
  for (const ch of String(key ?? "")) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return (h % 7) + 1;
}

/** A card id that can be a profile image: a whole positive number that is
 *  not a tower troop. Anything else (a string, a negative, a fraction) is no
 *  picture, so nothing but a number ever reaches the image's address. */
export function avatarCardOf(card: unknown): number | null {
  return typeof card === "number" &&
    Number.isSafeInteger(card) &&
    card > 0 &&
    !isTowerTroop(card)
    ? card
    : null;
}

/** The picture's place in the circle, as the CSS reads it. */
export function avatarCropStyle(card: number): CSSProperties {
  const c = avatarCrop(card);
  return {
    "--avatar-x": `${c.x}%`,
    "--avatar-y": `${c.y}%`,
    "--avatar-scale": String(c.scale),
  } as CSSProperties;
}

/** The card to draw, or null once its art has failed to load (the initials
 *  then stand in), with the handler that notices. Shared by the kit's
 *  Avatar and the account button and menu. */
export function useAvatarCard(card: unknown): {
  card: number | null;
  onError: () => void;
} {
  const id = avatarCardOf(card);
  const [failed, setFailed] = useState<number | null>(null);
  return {
    card: id !== null && failed !== id ? id : null,
    onError: () => setFailed(id),
  };
}

/** The picture itself: decorative, its own name never read. */
export function AvatarPicture({
  card,
  onError,
}: {
  card: number;
  onError: () => void;
}) {
  return (
    <img
      src={cardArtSrc(card, "base")}
      alt=""
      loading="lazy"
      decoding="async"
      onError={onError}
    />
  );
}

export function Avatar({
  name,
  tag,
  card = null,
  clan = false,
  small = false,
  large = false,
}: {
  name: string | null | undefined;
  tag?: string | null;
  /** The profile image's card, when the player's verified account chose
   *  one. A clan never has one. */
  card?: number | null;
  clan?: boolean;
  small?: boolean;
  /** A clan's crest (canvas .crest) or a player page's head (.phead), 84px. */
  large?: boolean;
}) {
  const picture = useAvatarCard(clan ? null : card);
  const cls = [
    "kit-av",
    clan ? "kit-av--clan" : `kit-av--${avatarHue(tag ?? name)}`,
    picture.card !== null ? "kit-av--image" : null,
    small ? "kit-av--s" : null,
    large ? (clan ? "kit-av--crest" : "kit-av--l") : null,
  ]
    .filter(Boolean)
    .join(" ");
  if (picture.card !== null)
    return (
      <span
        className={cls}
        style={avatarCropStyle(picture.card)}
        aria-hidden="true"
      >
        <AvatarPicture card={picture.card} onError={picture.onError} />
      </span>
    );
  return (
    <span className={cls} aria-hidden="true">
      {avatarInitials(name)}
    </span>
  );
}
