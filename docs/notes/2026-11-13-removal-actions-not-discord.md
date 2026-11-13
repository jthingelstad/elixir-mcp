# 2026-11-13 — Removals, promotions and demotions never go to the clan's Discord

Jamie's rulings of 2026-11-13. The docs promise "Nobody below co-leader
ever sees a removal action", yet a clan's Actions channel got removal
Actions (`discordShareable` kept out only a member's own), and the same
channel carries welcomes, which are Elders' to take. The lead
recommended "keeping removal Actions out of Discord entirely, so the
promise holds"; Jamie: "Agree with your other recommendations." Then,
of open promotions and demotions: "Pending promotions and demotions
should only be visible to leaders, not elders." Elixir cannot tell who
reads a Discord channel, so they stay out of it too. Of departure
Actions, which name a kicked member: "no, it is obvious to all clan
members when someone is kicked versus leaves. It shows in clan chat.
Nothing new." They keep posting.

## What changed

- `ACTION_TYPES` (`packages/clan-engine/src/actions.mjs`) carries
  `discord: false` on `removal`, `promotion` and `demotion`.
  `discordShareable` (`packages/clan-engine/src/discord.mjs`) refuses a
  kind marked so, as well as a member's own Action. A per-kind flag, not
  the audience: awards, rules announcements and departures are leaders'
  Actions too and keep posting under the 2026-10-10 and 2026-10-11
  rulings.
- The sweep in `packages/clan/src/manage/discord.mjs` filters by
  `discordShareable` before choosing posts and edits, so these three get
  neither: no post, no delivery row, no quality-ledger row, and no edit
  on close for one posted before the change. Those messages stay in
  Discord as they were; nothing in a real Discord was edited or deleted.
- Still posted, as before: departure, welcome, awards standings, awards
  announcement, rules announcement. A member's away prompt is still never
  posted.
- A completed removal, promotion or demotion is told to the clan as
  before (`sharing.mjs` `departure_classified` and `role_change_made`,
  and the activity channel, which carries clan-visible timeline items
  only).
- Actions reach Discord in one mode, code (`mode: "code"` in the quality
  ledger); the model-edited mode is the activity channel's, which tells
  no Actions.

## Who sees an open promotion or demotion

Checked, no change needed: every reader of open Actions goes through
`canAct`, which gives a `leaders` Action to the Leader and Co-Leaders
only. That is the Actions page and an Action by number (`mayRead`), a
comment, a decision (403 `leaders_only`), the rail's count
(`openActionCount`), "You here" (`memberView`), Home's Needs you
(`needsView`, `homeView`), the morning mail (`actionsWaitingMail`) and
the own view's waiting list (`actionsWaitingFor`, `clans_my_view`).
Standing reads no Actions. Pinned for a member and an Elder in
`packages/clan/test/manage.test.mjs` (including the Elder a demotion is
about), `clan-engine/test/mail.test.mjs` and `own-view.test.mjs`.

## Copy

- Policy's **Becoming an Elder** line ends "Only the Leader and
  Co-Leaders see a promotion or demotion before it's done; it's shared
  with the clan once it is."; **When you go quiet** drops "If they post
  the clan's Actions to Discord, a removal goes there too." (`seesFor` in
  `HouseRules.jsx`).
- Settings › Discord names what is posted and what never is; the docs
  (clan-actions, clan-actions-delivery, clan-settings, clan-policy,
  inactivity-clock, privacy) and a What's new entry say the same.

No migration. MCP and the JSON API unchanged.
