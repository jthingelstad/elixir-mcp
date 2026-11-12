import { useFollowPlan } from "../lib/queries.js";
import { FollowAll, FollowButton, followPlanLine } from "./follow.jsx";

/**
 * Follow everyone in a clan, from Clan › Members (2026-11-12, the canvas's
 * Members head). Lent to Clan through createClanRoutes (packages/clan-web
 * src/lib/host.js), so it is the player page's follow-all: one confirmed
 * act, priced before the tap by the same plan (`GET /api/me/follow-plan`
 * with the clan's tag), refused whole past the limit, your own players
 * left out. Every member who reads Members sees it, not only leaders.
 *
 * Beside it, how many of the clan you follow now. Past the limit the
 * button stays shut and the plan's own refusal says why, in sight rather
 * than behind a dialog that cannot go.
 */
export function FollowClan({ clanTag, clanName = null }) {
  const ask = { clan_tag: clanTag };
  const plan = useFollowPlan(ask);
  const p = plan.data ?? null;
  const all = Boolean(p && p.to_follow === 0 && p.following > 0);
  const refused = Boolean(p && !p.fits && p.to_follow > 0);
  return (
    <div className="follow-clan">
      {p ? (
        <span className="kit-tiny">
          You follow {p.following.toLocaleString()}
        </span>
      ) : null}
      {all ? (
        <button type="button" className="btn btn--sm" disabled>
          Following everyone
        </button>
      ) : p && p.to_follow === 0 ? null : (
        <FollowAll
          ask={ask}
          label="Follow everyone"
          title={`Follow everyone in ${clanName ?? clanTag}?`}
        />
      )}
      {refused ? (
        <p className="kit-tiny follow-clan__note" role="status">
          {followPlanLine(p)}
        </p>
      ) : null}
    </div>
  );
}

/**
 * One member's Follow, on a roster row (G6, 2026-11-12). Priced by the
 * clan's own follow plan, the read FollowClan already makes (one read for
 * the roster, never one per row), so the dialog says the cost from the
 * same count and the slot limits as every other Follow. Your own players
 * get nothing; one you follow already reads "Following".
 */
export function FollowMember({ clanTag, playerTag, name = null }) {
  const plan = useFollowPlan({ clan_tag: clanTag });
  const p = plan.data ?? null;
  if (!p || (p.yours ?? []).includes(playerTag)) return null;
  const row = (p.players ?? []).find((x) => x.player_tag === playerTag);
  if (!row) return null;
  if (row.following)
    return <span className="kit-tiny roster-follow__on">Following</span>;
  return (
    <FollowButton
      tag={playerTag}
      name={name}
      className="btn btn--sm"
      cost={{
        free: row.free,
        following: row.following,
        used: p.used,
        limit: p.limit,
      }}
    />
  );
}
