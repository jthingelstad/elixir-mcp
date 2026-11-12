# 2026-11-12 — Settings › What members see

Social slice 11 (#769, tracker #752, plan note
`2026-11-11-social-build-plan.md`). One Settings page,
`/settings/what-members-see`, gathering who sees what of a person as the
code runs today. It is a description, not a control: every choice links to
the page that owns it. DECISIONS: "What is public about an account",
"Everyone signs in; shared posts stay public".

## What the page says, and the code behind each line

A line on this page that stops being true is a defect of the page.

- **Members see your players' games** (name, tag, clan, profile, battles,
  decks, timeline): every record read needs an account and reads any
  recorded player (`services/web-api/src/routes/explore.mjs`, pinned by
  `services/web-api/test/public-boundary.test.mjs`).
- **That a player is yours is not shown yet**: no member-facing read
  joins a claim to another account. Two answers say only that *some*
  account is behind a player: `VERIFIED_ELSEWHERE` from
  `services/web-api/src/routes/verify.mjs`, and a follow's
  `free_because: followed_by_others` (`packages/claims/src/pool.mjs`). The
  page also says that DECISIONS makes follows, followers and the verified
  player public to members, unbuilt, so it promises nothing the rule
  takes back.
- **A highlight you post** is on the player's timeline for its followers,
  with no account in it (`highlightItems` in
  `packages/tools/src/activity/entries.mjs`; `share_url` only for the
  posting account), and a follower's Discord cross-post carries it, edits
  included, and keeps a posted line after a deletion (slice 4's default,
  `2026-11-11-social-slice-4-highlight.md`;
  `2026-11-12-highlight-edits-reach-readers.md`).
- **A collector you run** is credited to the operator's primary player on
  the collectors list and the public status
  (`packages/tools/src/public-status.mjs`).
- **In Clan**: the map place with local time for the clan's verified
  members, an away for its leaders, leader decisions under the game name,
  and a Discord action edited with who closed it
  (`packages/clan/src/manage/social.mjs`, `packages/clan/src/handler.mjs`; docs `clan-actions-delivery`).
- **A clan agent with Discord connected** maps a Discord user id to the
  asker's primary or alt tag and verified flag, for a clan the agent
  tracks, never the Discord name or email (`askerFor` in
  `packages/tools/src/entitlements.mjs`; docs `agents#knowing-which-human-is-asking`).
- **A battle link** opens with no account: names, clans, trophies, decks,
  towers, the ending, the left player's session and earlier meetings; its
  JSON carries tags (`services/web-api/src/battle-page.mjs`,
  `services/web-api/src/routes/battle.mjs`). The link is the battle's id
  only (`packages/record/src/battle-links.mjs`).
- **A shared highlight** opens with no account: the player's game name,
  the words and the battle; its picture carries name, words and link; no
  account id, nickname, email or highlight id; a deleted one stops opening
  within about a minute (`services/web-api/src/highlight.mjs`,
  `services/web-api/src/routes/highlight.mjs`).
- **Only you, or nobody else**: nicknames, email (but for a family app you
  allow), Discord name and profile, and the account's machinery.
- **Follow slots** are `/api/me`'s `entitlements.player_slots` (`used`,
  `limit`, `free`, from `pooledUsage`), drawn as Players & tracking draws
  them. Nothing is recounted.

## The lens

The battle page itself (`Battle` from `apps/web/src/views/Battle.jsx`)
drawing the main player's latest battle (`battles_query`, limit 1) from
`/api/public/battles/<ref>`, the one answer every viewer gets. Only the
viewer changes: a signed-in member with no claims (names link to player
pages, no "you" chip) or no account (plain names and the invitation).
`Battle` and `BattleView` take `standIn`, so the page draws nothing that
reads the real reader's own things: the Highlight this battle panel
(slice 4) would otherwise show your own post controls inside the lens.

## Defaults taken [engineering]

- The lens is the battle page only. The Explore player page is left out:
  it reads the reader's own nicknames, so it cannot be drawn as someone
  else without a second projection.
- Location sharing, the digest, the RSS link and Follow me are not built,
  so the page names none of them and shows no control for them.
- `privacy.md` is unchanged: policy pages change only on Jamie's word. The
  pull request proposes a one-line pointer for Jamie.
- The page sits in the rail after Profile, at `/settings/what-members-see`.
