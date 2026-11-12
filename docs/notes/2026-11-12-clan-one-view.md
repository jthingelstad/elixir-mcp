# 2026-11-12 — Clan as one view: the canvas tabs

Slice 8 of the social layer (#766, tracker #752). Jamie, 2026-11-12, asked
"Slice 8, Clan: replace Clan's five tabs with the canvas tabs Feed,
Standings, War, Members, Policy and Run (leaders only)?", answered "Yes,
the canvas tabs (Recommended)". `docs/DECISIONS.md` and
`docs/product/structure.md` and `clan.md` carry it.

## The tabs

| Was | Now | Who |
| --- | --- | --- |
| Today | Feed (`/feed`), the landing | every member |
| Awards | Standings (`/standings[/season]`) | every member |
| Season | War (`/war[/season]`) | every member |
| Members | Members | every member |
| (none) | Policy (`/policy`) | every member |
| Run | Run (`/run`), now holding Actions: Waiting (`/run/actions`) and Decided (`/run/decided`) | verified leader and co-leaders |

Today's Waiting and Decided moved under Run; the Feed keeps what waits
on the clan as a side card.

## Redirects

`apps/web`'s root route calls clan-web's `clanMoved` (`src/lib/moved.js`):

- bare `/clan/<tag>`, `/today`, `/actions` (no number), `/manage` to `/feed`;
- `/today/decided` and `/manage/history` to `/run/decided`;
- `/season[/x]` to `/war[/x]`; `/awards[/x]` and `/trophies` to `/standings[/x]`;
- `/actions/<n>` (one Action, linked from mail and Discord) stays.

Clan's mail now links `/feed`, and the mail's clan door goes to War.

## Run's gate

The page hides Run unless the reader is a verified leader or co-leader
(`leads()`), and draws a refusal on any Run address otherwise, without
asking the server. The server refuses it as well: `GET /api/clan/clans/<tag>/run`
(new, the page's one question) and Run's reads (`/history`, `/model`,
`/voice`, `/discord`, `/activity-discord`, `/sharing`) answer 403
`leaders_only` to anyone else. Every one of those reads was already
leader-only in its own service; the handler's check is defence in depth,
pinned by `packages/clan/test/run-gate.test.mjs`.

## The Feed's read

`GET /api/clan/clans/<tag>/feed` (`services/web-api/src/clan-feed.mjs`)
is the clan's timeline (`buildTimeline`, the clan as subject) for the last
seven days, newest first, by the timeline's reader rules, with the
highlights of the clan's current members (`highlightTags`, new on the
timeline's entries: members whose `clan_membership` row has no
`left_observed_at`). Each item is its sentence, kind, time and, for a
highlight, its words and battle link; never its facts whole and never the
reader's own account items. Pinned by
`services/web-api/test/clan-feed.test.mjs`.

## Policy

`GET /policy` now answers every member `how` (the policy in Standing's
words) and `weights` (Elder's weights), the same text Standing uses; the
editing fields stay Run's. The policy is public in the clan directory (A2),
so this widens nothing.

## Defaults taken [engineering, 2026-11-12]

- Run opens on Waiting; Run stays for the leader and co-leaders, as built.
- A non-leader following an old Waiting or Decided link lands on the Feed
  or the refusal, never Run's tools.
- "How it works here" in Members links to Policy.
- The Feed reads seven days, with no rate limit of its own.
- The Standings page keeps its "Awards" heading.
- A name opens the player page (`/home/player/<tag>`); Review and an
  Action's "Open their page" keep the member page, which the player page
  reaches through "Open in Clan".
- Six tabs scroll sideways on a phone, with the kit's fade hints.
- `apps/web`'s `home/logic.js` and `ladder/common.jsx` still link the old
  addresses; the redirects cover them, and slice 7 owns that code.

No contract change: MCP 11.21.0 and the JSON API are unchanged. No
migration.
