# 2026-11-13 — Design pass three: Follow on the clan page

Third design pass, part 2. The clan head (`packages/clan-web`
`ClanHead.jsx`) gets the player page's Follow control for the clan
itself.

- **Which follow.** Elixir's own clan follow, the `account_clan` row Home's
  "Your clan" and Settings › Players & following already make: `GET
  /api/me/clans` says whether this clan is one of yours and how many clan
  slots are used, `POST /api/me/clans {action: "add", scope: "activity"}`
  follows it. Both are Elixir's follow routes (`services/web-api` `routes/
  clans.mjs`), unchanged; no server read was added and nothing in
  `packages/clan`, `packages/clan-engine` or the Clan handler moved.
- **How it reaches Clan.** `FollowThisClan` lives in the app
  (`apps/web/src/home/FollowClan.jsx`, beside Members' Follow everyone)
  and is lent to clan-web through `createClanRoutes` and the host context
  (`lib/host.js`), like `FollowClan` and `FollowMember`. Without a host it
  is left out.
- **What it draws.** The player page's pieces: `ConfirmAction` with
  `btn btn--follow`, "Follow <clan>?", what Elixir records (Home's words),
  the slot line ("Uses 1 of your N clan slots · M used"), confirm Follow;
  then `kit-phead__state` "Following". Full slots do not shut it, unlike
  the player page: a clan an active agent already follows costs no new
  slot, and only `addClan` can tell, because `GET /api/me/clans` lists the
  person's own rows but pooled usage (Codex on #896). The dialog says the
  slots are full and that Elixir will say so if this clan needs one; the
  server's 429 message then shows in the dialog. Unfollowing stays in Settings, as for a
  player.
- **Your own clan.** No special case. Elixir follows the primary player's
  clan by itself when a slot is free (2026-10-08), so it usually reads
  Following there. Every clan page is one of your clans (Clan has no page
  for a clan you are not in), so the button never offers a stranger's clan.
- **Who sees what:** unchanged. The read and write are the reader's own.
- **Tests.** `apps/web/e2e/clan/follow-this-clan.spec.ts`: not followed
  (asks, the words and slot line, axe, the exact POST, then Following),
  followed (Following, no button), slots full (asks, then shows the 429).
