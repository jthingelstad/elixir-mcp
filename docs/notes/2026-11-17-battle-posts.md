# 2026-11-17 — A highlight is a post about a battle

Jamie, 2026-11-17: a highlight is a post with a battle attached. There was
one kind of player writing (posts) and a second, older one (highlights)
with its own table, routes, tab, share link and Discord path. Now there is
one: a post, which may carry a battle. Ships in MCP 13.9.0 and migration
0292; the JSON API is unchanged at 5.1.0.

## Migration 0292

`0292_battle_posts.sql` runs under `set local lock_timeout = '5s'`, so the
foreign key's brief SHARE ROW EXCLUSIVE lock on `battle_participant` fails
fast rather than queueing ingest; the deploy can be retried.

- **Columns on `account_post`:** `battle_id`, `share_id` (unique,
  `^[a-z2-7]{15}$`), `shared_at`, `clan_discord_at`, `clan_discord_clan`,
  `revision` (default 1) and `updated_at`.
- **Constraints:**
  - `account_post_body_check`: at most 500 characters, and empty only
    on a post about a battle (words stay optional there, as on a
    highlight).
  - `account_post_battle_alone`: a post about a battle carries no deck
    and no cards.
  - `account_post_share_battle`: `share_id` and `shared_at` are set
    together, and only on a post about a battle.
  - `account_post_battle_fkey`: `(battle_id, player_tag)` references
    `battle_participant` on delete cascade, so only a player who played
    the battle can post about it, and retention takes the post with the
    battle.
- **Indexes:** `account_post_player_battle` (unique: one post per player
  per battle), `account_post_battle` (a battle page's posts) and
  `account_post_player_changed` (a player's battle posts by when their
  words last changed, for the timeline's window).
- **The copy:** every `battle_highlight` row becomes an `account_post` row
  under item id `'tl_' || left(sha256('battle_highlight|' || highlight_id), 20)`
  in hex, the id the timeline already served for it (`storyId` in
  `@elixir-mcp/tools`), so cheers and comments keyed by that id still name
  it. Author, player, battle, words, times, revision, share link and
  Discord stamp all carry over.
- **`comment_check`** gains the kind `battle_post`.
- **The old table stays, read-only:** a trigger refuses insert and update
  with SQLSTATE 25006 (`read_only_sql_transaction`) and mirrors a delete
  onto the post it became, so an old Lambda mid-deploy, an account removal
  or a battle cascade still removes it. Dropping `battle_highlight` is a
  later contract step.

`services/migrate/test/battle-posts-migration.test.mjs` runs the file on a
scratch database put back to 0291, with highlights in every state.

## MCP 13.9.0

- `elixir_timeline`: `battle_highlight` is schema version 2 and gains
  `facts.post_id`. `facts.highlight_id` carries the same value from now
  on, a decimal string where it was a UUID. The item `id`, `at`,
  `facts.words`, `facts.battle` and `share_url` are as before. The
  sentence says "posted about a 3-1 win against …".
- `players_highlights`: same shape; it answers with the player's posts
  about their battles. Posts about no battle are never in it.

The kind and tool keep their names so no agent breaks.

## The readers that changed

- **Web API:** `highlight.mjs` and `routes/highlight.mjs` are gone; posts
  about battles ride `/api/me/posts` (`{ battle, player_tag?, text? }`),
  `/api/me/post-shares`, `/api/me/post-discord` and `/api/me/post-reports`
  (`routes/posts.mjs`, `battle-posts.mjs`). The shared page `/h/<id>` and
  `/api/public/posts/<id>` come from `routes/shared-post.mjs`. Home's
  feed, the bell, the player page, the clan feed, cheers, the RSS feed
  and the share image read `account_post`.
- **The app:** the battle page's panel is `BattlePosts.jsx` (the **Post**
  button, **Edit words**, **Share**, Delete, **Post in your clan's
  Discord**); a post about a battle draws in `home/Post.jsx`; the player
  page shows the player's posts at the top of its Timeline tab, and the
  Highlights tab is gone.
- **Elsewhere:** `@elixir-mcp/tools` activity entries, the digest
  (`build-digest.mjs`), mail rendering, syndication
  (`battle-post-share.mjs`, the wake), Stamps (Storyteller from
  `post:<id>`), Clan's activity read, retention and the account removal op.

## Product calls made in the build [engineering]

- **The limits:** a post about a battle has its own room, 3 a minute and
  30 a day, apart from plain posts' 1 a minute and 5 a day, so posting
  about battles stays a quick tap.
- **The words check:** new words on a post about a battle get the same
  check as any post (no link, long number or @handle). Words copied from
  highlights are kept as they were.
- **Posts about battles work while plain posts are off:** a highlight
  never depended on the posts switch, so a post about a battle doesn't
  either.
- **Cheers and comments** on a post about a battle stay where they were
  for highlights: in the reader's own Timeline and the clan's Feed. A
  report reaches anyone who can see the post, a player's page included.
- **Names kept:** the `battle_highlight` kind, `players_highlights`, the
  `/h/<id>` link and the clan setting key `highlights`. The docs keep the
  anchors `#highlight-a-battle` (battles) and `#highlights` (timeline)
  beside the new `#post-about-a-battle` and `#posts-about-battles`.
- **The words a player reads:** "Post about a battle", "Shared posts about
  battles" for the clan's Discord setting.

## Left after this change

Each becomes an issue if it is still true after the follow-ups:

- The admin post queue and the battle-post rate limit when comments are
  off (the stack's `CommentsEnabled`).
- Dropping `battle_highlight` and its trigger, once no running code reads
  it.
- `privacy.md` and `terms.md` still say "highlight"; their wording is
  Jamie's (a `needs-jamie` issue).
- The player page lost its empty-tab hint on how to highlight; the battle
  page's **Post** button is the way in.
