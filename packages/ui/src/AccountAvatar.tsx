import { AvatarPicture, avatarCropStyle, useAvatarCard } from "./Avatar.tsx";

/**
 * The account's own avatar in the bar's button and the account menu: its
 * profile image when it chose one (2026-11-14), else its initials. Drawn
 * for the eye only; the button's name says whose account it is.
 */
export function AccountAvatar({
  card,
  initials,
  large = false,
}: {
  card?: number | null | undefined;
  initials: string;
  large?: boolean;
}) {
  const picture = useAvatarCard(card);
  const cls = [
    "chrome__avatar",
    large ? "chrome__avatar--lg" : null,
    picture.card !== null ? "chrome__avatar--image" : null,
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
      {initials}
    </span>
  );
}
