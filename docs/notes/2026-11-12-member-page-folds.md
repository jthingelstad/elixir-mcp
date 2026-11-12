# The member page folds into the player page (2026-11-12)

Jamie, 2026-11-12: one page per player. Clan's member page
(`/clan/<TAG>/members/<tag>`, `MemberActivity`) is now the **Clan** tab of
`/home/player/<tag>`.

- `packages/clan-web/src/views/PlayerInClan.jsx` lends apps/web two things:
  `useClanOf(clanTag, enabled)`, the viewer's entry for that clan from
  Clan's own `/api/clan/me` (any of their clans, not only the primary
  player's), and `PlayerInClan`, `MemberActivity` drawn without its head.
- Access is unchanged: the tab is drawn only for a viewer with a player in
  the clan, while Clan is open to them (`features.clan_internal`), and the
  read is still `GET /api/clan/clans/<tag>/members/<tag>/activity`, which
  the server gates. The activity clock stays leaders' and co-leaders'.
- Another member's old address redirects in Clan's shell (it needs the
  session: your own tag stays `YouHere`) to `/home/player/<TAG>?tab=clan`
  (`playerInClanPath`). Review rows and an Action's "Open their page" link
  there directly. The player page's "Open in Clan" link is gone; the tab
  replaced it. `you.clanmate` in `/api/player` is no longer read by the web.
