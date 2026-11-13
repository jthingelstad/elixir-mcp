# 2026-11-13 — Old addresses stop forwarding

Jamie, 2026-11-13: "You don't have to redirect all the URLs. That could get
messy. It is fine to break url support." The forwards that kept pre-redesign
addresses alive went, and every producer that still named a forwarded
address now names the page itself.

## Producers repointed

- Stats' Clan war line (`apps/web/src/ladder/common.jsx`) links
  `/clan/<tag>/war` ("See the race in Clan › War"), not `/season`.
- Home's away card (`apps/web/src/home/logic.js`) links
  `/clan/<tag>/members/away`, not `/clan/you/away`.
- A clan's link in mail (`packages/mail/src/render.mjs` `clanUrl`) and in
  Discord and timeline lines (`packages/syndication/src/lines.mjs`
  `clanUrl`) is `/clan/<tag>/feed`, not the bare `/clan/<tag>`.
- An Action link with no number (`packages/auth/src/clan-context.mjs`
  `actionUrl`) is `/clan/<tag>/feed`; a numbered one stays
  `/clan/<tag>/actions/<n>`.
- Tool text and docs that named a moved doc section name its page now
  (`players_series`' description: `freshness-and-gaps#daily-series`; the
  agents page's example: `freshness-and-gaps#completeness`). The acceptance
  suite's docs case and the Gym's `elixir_docs` blocks ask the current page.

## What stopped working

- Every `/console/...` address: account, agent, admin, status, explore,
  data and sign-in.
- Every `/ladder/...` address, the retired mails' `/ladder?player=` links
  included.
- `/home/timeline`, `/home/friends`, `/data/service` (the route still loads
  the app, which shows its missing page), `/clan/feedback`,
  `/clan/maintain`.
- Clan's old tab addresses: `today`, `season`, `awards`, `week`, `roster`,
  `me`, `standing`, `trophies`, `recruit`, `map`, `discord`, `manage/...`,
  `members/standing`, `members/review`.
- The doc forwards (`apps/site/src/_data/docForwards.js`, 70 entries): the
  browser no longer follows an old `page#section`, and `elixir_docs` and
  `elixir://docs/...` answer an old pair as not found (MCP contract patch).

## What was kept, and why

- `/clan/<tag>` goes to `/clan/<tag>/feed`: mail and Discord posts already
  sent name it, and it is a clan's natural address.
- `/clan/<tag>/actions` (no number) goes to `/clan/<tag>/feed`: Clan's
  Discord posts (`packages/clan-engine/src/discord.mjs`,
  `packages/clan/src/manage/discord.mjs`) still emit it, and those are not
  this change's to edit.
- Everything Elixir sends today resolves without a forward and is pinned in
  `apps/web/test/moved.test.js`: `/clan/<tag>/actions/<n>`, Settings'
  emails, feedback, collectors and players, `/home/...`, `/signin`, the
  clan's tabs. Sign-in and unsubscribe links, shared post and battle links
  and the RSS URL never went through a forward.
- `/clan/you/...` is Clan's own page, not a forward; nothing links it now.

## Not touched

`infra/template.yaml` still routes `/console`, `/ladder` and
`/data/service` to the app, so `APP_PATHS` in `apps/web/src/App.jsx` keeps
them (dropping them while CloudFront sends them would loop). A later infra
change can drop those behaviours.
