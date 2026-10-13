import { Icon, Link, Tag } from "@elixir-mcp/ui";
import { CONSOLE } from "../lib/console.js";

/**
 * Why the account has no primary player, where the primary is shown
 * (Tracking and the Overview's players).
 *
 * A verified tag is its owner's (Jamie, 2026-10-12, #556): when another
 * account verifies a tag, this account's primary on it ends and nothing is
 * promoted in its place; a signup tag another account had verified is not
 * added. `GET /api/me` carries `claim_notice` while the account has no
 * primary and has added nothing since. It names the tag, never the account
 * that verified it.
 */
export function ClaimNotice({ me, onTracking = false, className = "" }) {
  const notice = me?.claim_notice;
  if (!notice?.player_tag) return null;
  const tag = <Tag tag={notice.player_tag} />;
  const others = (me.claims ?? []).length > 0;
  const addYours = onTracking ? (
    "Add your player below."
  ) : (
    <>
      Add your player under{" "}
      <Link className="underline" to={`${CONSOLE}/account/tracking`}>
        Tracking
      </Link>
      .
    </>
  );
  return (
    <div className={`callout callout--warn ${className}`.trim()} role="status">
      <Icon name="shield-x" size={17} />
      <span>
        {notice.kind === "primary_ended" ? (
          <>
            Another account verified {tag}, so it is no longer your primary
            player, and you have none: nothing defaults to you.{" "}
            {others
              ? "Open one of your players and make it primary, or add yours."
              : addYours}
          </>
        ) : (
          <>
            {tag}, the player tag you signed up with, is verified by another
            account, so it was not added. {addYours}
          </>
        )}{" "}
        If that player is yours, sign in to the account that verified it, or
        tell us through{" "}
        <Link className="underline" to={`${CONSOLE}/account/feedback`}>
          Feedback
        </Link>
        .
      </span>
    </div>
  );
}
