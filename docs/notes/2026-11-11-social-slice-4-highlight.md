# 2026-11-11 — Highlight a battle to your timeline, then share it

Social slice 4 (#762, tracker #752, plan note
`2026-11-11-social-build-plan.md`). Jamie, 2026-11-11: highlighting into the
timeline is the default use, and sharing a link shares that timeline post.
DECISIONS: "A battle has its own page", "Timeline shape", "Everyone signs in;
shared posts stay public", "Invites carry no referral ids", "Flat: tone, not
outlines".

## What changed

- **Migration 0239, `battle_highlight`.** One row per player per battle: the
  player, the battle (foreign key to `battle_participant`, so the player
  played it; cascades if the record ever drops the battle), the posting
  account, the words (as typed, at most 500 characters), and `share_id`
  (null until shared, then 15 base32 characters, 75 random bits). A new,
  empty table; `lock_timeout` 5 s for the foreign keys' instant lock.
- **Highlight it.** `GET/POST /api/me/highlights`, `PUT/DELETE
  /api/me/highlights/<id>`, `POST /api/me/highlights/share`: the signed-in
  person's own, the contract header required on writes, never an agent's
  console. A post needs a **verified** claim on a player who played the
  battle (403 `not_your_battle` otherwise; an unverified claim is anyone's to
  make). One per player per battle (409). Edit, share and delete are scoped
  to the posting account; anyone else gets 404.
- **Share it.** `/h/<share id>` is the app shell with the post's preview tags
  (title "<name> on Elixir: <battle>", the words clipped to 180 in the
  description, the post's own url and picture); `/h/<share id>.png` is the
  battle's picture with the player's name, the words and the post link in its
  foot; `/api/public/highlights/<share id>` is the JSON: the battle exactly as
  `/api/public/battles/<ref>` reads it plus `highlight` (`share_id`, `url`,
  `image`, `player_tag`, `name`, `side`, `outcome`, `words`, `created_at`).
  Nothing of the account: no account id, nickname, email or highlight id.
  Both routes are in the public-boundary list, class "record". The edge
  caches `/h/*` as it does `/battle/*`; the origin answers a minute, so a
  deleted post stops opening within about a minute (no invalidation: that
  would need an IAM grant).
- **Timeline.** A new kind, `battle_highlight` (section `battles`, public,
  schema version 1): the one single-battle item, with the player's words, the
  battle's facts and link, and `share_url` only on the posting account's own
  timeline. Follow-ups: `battles_query` for the battle, `players_summary`.
  MCP **11.20.0** (minor; the contract file says it). No MCP write tool.
- **Web.** The battle page gets a **Highlight this battle** panel for a
  signed-in person the server says may post (gold **Post to your timeline**,
  solid **Share** and **Edit words**, **Delete** as a link behind a confirm).
  `/h/<id>` is a page of its own: the player's name and words over the battle
  page's view. Home's Timeline row for a highlight links the battle and, when
  it is yours and shared, copies the share link.
- **Escaping.** Names and words are stored as typed and escaped at each
  output: the preview tags (`namedShell`), the SVG picture (`text()`), and
  React. `highlight.test.mjs` and `share-image.test.mjs` post a hostile name
  and hostile words through all three server outputs.
- **Account removal.** `{account_remove}` deletes the account's highlights
  (their share links 404) before the account; the docs' removal lists say so.

## Defaults taken [engineering]

- The highlight belongs to the posting account: if the claim moves later, the
  post stays, and only that account edits, shares or deletes it.
- The share id is 15 base32 characters from 15 random bytes.
- A minute's cache at the origin for `/h/*` and its JSON and picture.
- A highlight is public and publishable like any battle item, so a timeline
  cross-post to Discord carries a followed player's highlight words.
  "Cross-posting to Discord" says every publishable item, not filtered
  (Jamie, 2026-10-10); listed in the pull request as a question.
- Words keep line breaks; other control characters are dropped.

## Not in this slice

Sharing a Moment, posting to a clan's Discord, reactions, and the highlight on
a player's profile (DECISIONS "A battle has its own page" names the profile
too; no profile page reads highlights yet).
