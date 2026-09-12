import { Icon } from "./Icon.jsx";

/** The checkmark beside a verified player, wherever a claim is listed:
 *  the claim was proven with the deck-slot challenge (Verify). */
export function VerifiedMark({ size = 14 }) {
  return (
    <span className="verified" title="Verified" aria-label="Verified">
      <Icon name="circle-check" size={size} />
    </span>
  );
}
