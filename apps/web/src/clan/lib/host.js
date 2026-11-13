import { createContext, useContext } from "react";

/**
 * What the application Clan is joined into lends its views (2026-11-12).
 * `createClanRoutes(parent, options)` passes its options to ClanShell, which
 * provides the ones a view draws here, so Clan reuses the app's own parts
 * instead of a second copy (golden rule 7 holds inside the repo too):
 *
 * - `FollowClan({ clanTag, clanName })`: Members' "Follow everyone", the
 *   same confirmed follow-all, priced by the same plan, as the player
 *   page's (apps/web src/home/FollowClan.jsx).
 * - `FollowMember({ clanTag, playerTag, name })`: a roster row's Follow
 *   (G6), priced by that same clan plan, one read for the whole roster.
 * - `FollowThisClan({ clanTag, clanName })`: the clan head's Follow
 *   (2026-11-13), Elixir's own clan follow (`/api/me/clans`), drawn as the
 *   player page's Follow and "Following".
 *
 * Absent (a test, or a host that lends nothing), the view leaves it out.
 */
export const HostContext = createContext({});
export const useHost = () => useContext(HostContext);
