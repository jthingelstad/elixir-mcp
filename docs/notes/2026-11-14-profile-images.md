# 2026-11-14 — Profile images

Jamie: "Elixir Drop has a great method to allow players to have profile
images using circular crops from clash Royale cards. I want to wholesale
move that into Elixir. While doing it we should take any existing profile
images set in Drop and set them in Elixir. Going forward Drop will just use
whatever profile image was set in elixir." Who sees it: "Wverywhere your
player appears. Including alts I guess?"

This change moves the method. The import of Drop's images and Drop
reading Elixir's are later steps, with their seam named below.

## What ships

- **Migration 0268** (`0268_account_avatar_card.sql`): nullable
  `account.avatar_card_id` (integer, no foreign key: a card leaving the
  catalog must not refuse the row) and `avatar_set_at` (timestamptz). No
  backfill. `{account_remove}` nulls both with the rest of the tombstone.
- **`POST /api/me/avatar`** `{ card_id: <int> | null }`: a person's own
  session with the web contract header, like `POST /api/me/timezone`. The
  card must be in the current catalog as a card (`kind = 'card'`,
  `in_catalog`, with art); a tower troop, an unknown or retired id, or
  anything but a whole positive number is `400 unknown_card`. Signed out
  is 401; an agent has no such route under `/api/agent/<id>/` (404).
  Sixty writes an hour on `avatar#<account>`. `null` clears it.
  `GET /api/me` answers the account's own `avatar_card_id` (person only).
- **Who shows it** (`verifiedAvatars` in `packages/tools/src/social.mjs`,
  `verifiedAccount`'s rule for a page of tags in one statement): a player
  shows the image of the account that verified it as itself, its primary
  or a verified alt. An unverified claim, a follow, or a tag nobody
  verified shows initials; when a verification moves, the image follows
  the account. An account with no verified player sees its own image only
  in the top bar, the account menu and Settings.
- **Where:** Home's feed items, a player page's head and its follows and
  followers, Find's people lists, Clan's member list, the public shared
  post (`/h/<id>`), and the bar's account button and menu. Each read adds
  at most one statement for its whole page of tags, and none when it has
  no tags. `players_follows` and every other MCP tool are unchanged: the
  player route decorates `socialOf`'s answer, never `socialOf` itself.
- **The crop table** is `packages/ui/src/avatar-crops.ts`: Drop's 121
  rows unchanged (a test pins their sha256), the default
  `{ x: 50, y: 48, scale: 1.21 }` for any other card. The kit's `Avatar`
  takes `card`; the picture is the mirror's base art
  (`/assets/cards/<id>.png`), placed in the circle by CSS variables alone,
  never resized or re-encoded. A failed load returns to initials. The
  circle is plain: no ring, gradient or glow.
- **The picker** is Settings › Profile › Profile image
  (`apps/web/src/views/account/AvatarPicker.jsx`): search, the catalog by
  name, a large preview, Save and Remove.

## Cards to re-tune

- Drop's base art differs from the mirror's bytes for **26000014,
  26000039 and 26000046**. Their Drop crops are kept as they were; each
  wants a look against the mirror's art.
- **28000006 (Mirror)** and **28000025** have no Drop row and take the
  default crop.

## The seam for Drop

- **Import (a one-time op, not written here):** for each Drop player with
  an image, the Elixir account behind them, then
  `update account set avatar_card_id = $2, avatar_set_at = now() where
  account_id = $1 and avatar_card_id is null`, with `$2` checked against
  `card` (`kind = 'card' and in_catalog`). It never overwrites a choice
  made in Elixir, so it can run twice.
- **Drop reading it:** `GET /api/v1/me` does not carry it yet. Adding
  `avatar_card_id` there is a minor in `/api/v1`'s own semver.

MCP and JSON API unchanged. No contract version moves.
