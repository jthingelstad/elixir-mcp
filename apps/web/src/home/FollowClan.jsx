import { ConfirmAction, Tag } from "@elixir-mcp/ui";
import { api } from "../api.js";
import { useFollowPlan, useInvalidate, useMyClans } from "../lib/queries.js";
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
          className="btn btn--sm btn--gold"
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
    return <span className="kit-following roster-follow__on">Following</span>;
  return (
    <FollowButton
      tag={playerTag}
      name={name}
      cost={{
        free: row.free,
        following: row.following,
        used: p.used,
        limit: p.limit,
      }}
    />
  );
}

/** What following a clan costs, said before the tap: one of the account's
 *  clan slots for recording the clan only (the activity scope, Home's
 *  "Follow your clan"), shared with its agents. Nothing when the limit is
 *  not known; the write's own refusal says the rest. */
function clanFollowCostLine(slot) {
  if (!slot || slot.limit == null) return null;
  const n = (v) => v.toLocaleString();
  if (slot.used >= slot.limit)
    return `All ${n(slot.limit)} of your clan slots are in use. If this clan needs one, Elixir will say so.`;
  return `Uses 1 of your ${n(slot.limit)} clan slots · ${n(slot.used)} used`;
}

/**
 * Follow the clan itself, from its head (design pass three, 2026-11-13):
 * the player page's control, a confirmed Follow and then "Following". It is
 * Elixir's own clan follow, the one Home's "Your clan" and Settings make
 * (`GET` and `POST /api/me/clans`, activity scope): its roster, who joins
 * and who goes, and its races. Your own clan wears it like any other; Elixir
 * follows your primary player's clan by itself when a slot is free, so it
 * usually reads "Following". Stopping lives in Settings, as for a player.
 * Full slots never shut it: a clan your agent follows already costs no new
 * slot, and only the server's `addClan` knows that, so a refusal is the
 * server's 429 and its words. Nothing until the read is in.
 */
export function FollowThisClan({ clanTag, clanName = null }) {
  const { data } = useMyClans();
  const invalidate = useInvalidate();
  if (!data) return null;
  if ((data.clans ?? []).some((c) => c.clan_tag === clanTag))
    return <span className="kit-phead__state">Following</span>;
  const slot = data.slots?.activity ?? null;
  const name = clanName ?? clanTag;
  const cost = clanFollowCostLine(slot);
  return (
    <ConfirmAction
      label="Follow"
      className="btn btn--sm btn--follow"
      danger={false}
      title={`Follow ${name}?`}
      body={
        <>
          <p className="m-0">
            {clanName ? (
              <>
                {clanName} <Tag tag={clanTag} />
              </>
            ) : (
              <Tag tag={clanTag} />
            )}
            . Elixir records its roster, who joins and who goes, and its races.
          </p>
          {cost ? (
            <p className="kit-tiny" role="status">
              {cost}
            </p>
          ) : null}
        </>
      }
      confirm="Follow"
      run={() =>
        api.myClanAction({
          action: "add",
          clan_tag: clanTag,
          scope: "activity",
        })
      }
      onDone={() => invalidate()}
    />
  );
}
