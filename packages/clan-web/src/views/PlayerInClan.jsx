import { useMeQuery } from "../lib/queries.js";
import { MemberActivity } from "./MemberActivity.jsx";

/**
 * Clan on a player's page (2026-11-12): the member page Clan kept at
 * `/clan/<TAG>/members/<tag>` folded into `/home/player/<tag>` ("Yes, one
 * page", Jamie). Lent to apps/web, which mounts Clan and imports nothing
 * else of it here.
 *
 * Who sees it is who saw the member page: a person with a player in that
 * clan, as Clan's own session says (`/api/clan/me`), in any of their clans,
 * not only their primary player's. The server still refuses the read to
 * anyone else. Leaders and co-leaders also get the activity clock, as
 * before; nobody below sees it.
 */

/** The viewer's own entry for a clan, from Clan's session: `{ clan,
 *  pending }`. `clan` is null when the viewer has no player in it, or Clan
 *  did not answer (the tab is simply not drawn then). */
export function useClanOf(clanTag, enabled = true) {
  const on = Boolean(enabled && clanTag);
  const query = useMeQuery(on);
  if (!on) return { clan: null, pending: false };
  const env = query.data;
  const clans = env?.ok ? (env.data?.clans ?? []) : [];
  return {
    clan: clans.find((c) => c.clan_tag === clanTag) ?? null,
    pending: query.isPending,
  };
}

/** The member's record in the clan, without the page head the player page
 *  already draws. */
export function PlayerInClan({ clan, playerTag, navigate }) {
  return (
    <MemberActivity
      key={`${clan.clan_tag}-${playerTag}`}
      clan={clan}
      playerTag={playerTag}
      navigate={navigate}
      embedded
    />
  );
}
