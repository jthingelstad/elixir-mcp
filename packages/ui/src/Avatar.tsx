/**
 * An avatar (the canvas's .av, 2026-11-13): a name's initials on one of seven
 * fills, chosen from the tag so a person keeps theirs everywhere. Drawn for
 * the eye only: the name beside it is what a reader hears, so it is hidden
 * from the accessibility tree. A clan's is a rounded square with the gold
 * edge. Never a picture of anyone: Elixir has no player images.
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

export function Avatar({
  name,
  tag,
  clan = false,
  small = false,
}: {
  name: string | null | undefined;
  tag?: string | null;
  clan?: boolean;
  small?: boolean;
}) {
  const cls = [
    "kit-av",
    clan ? "kit-av--clan" : `kit-av--${avatarHue(tag ?? name)}`,
    small ? "kit-av--s" : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={cls} aria-hidden="true">
      {avatarInitials(name)}
    </span>
  );
}
