# 2026-11-14 — The profile image in /api/v1, and Drop's images come over

The next step after `2026-11-14-profile-images.md`: Drop shows the image
set in Elixir, with the account's primary player's game name, and Drop's
existing images are set in Elixir once.

## What ships

- **`GET /api/v1/me` answers `avatar`** (JSON API 5.1.0, an addition):
  `{ card_id, name, art_url, crop: { x, y, scale } }`, or `null` when the
  account chose none. `art_url` is the mirror's base art on Elixir's own
  origin (`https://elixir.poapkings.com/assets/cards/<id>.png`); `crop` is
  `avatarCrop(id)` from `packages/ui/src/avatar-crops.ts`, read through the
  new `@elixir-mcp/ui/avatar-crops` export, so Drop draws Elixir's circle
  without a copy of the table and a re-tuned crop reaches Drop with no
  Drop change. The numbers mean exactly what Drop's `PlayerAvatar` and
  `.player-avatar img` already do with them (`object-position: x% y%`,
  `transform: scale()`). `name` is the catalog's, for alt text.
- **The primary player and its game name were already there:**
  `players[]` carries `is_primary`, `claim_status` (`verified` once
  proved) and `name`, the game name as last recorded, and
  `principal.subject` names the primary. Nothing was added for them; the
  contract now says so, gives `claim_status` its enum, and says that
  every name is passed through as the game sent it, never cleaned in
  storage, for the client to escape at output.
- **`{avatar_import}`** (`services/migrate/src/ops-avatar-import.mjs`):
  `{"avatar_import": {"pairs": [{"account_id": "<uuid>", "card_id": <int>}]}}`
  is a dry run; with `"apply": true` it sets `avatar_card_id` and
  `avatar_set_at` only where `avatar_card_id` is null and the card is one
  `POST /api/me/avatar` accepts (`kind = 'card'`, `in_catalog`, with art),
  on person accounts only, in one transaction. It answers counts only:
  `pairs`, `would_set` or `set`, `already_had_one`, `unknown_account`,
  `unknown_card`, `malformed`, `repeated`. A rerun sets nothing. `npm run
  op` treats the pairs alone as a read and anything else (an `apply` key
  included) as a write that takes the lock.
- **Crops:** Drop's 121 rows are now `DROP_AVATAR_CROPS`, still pinned by
  their sha256; Elixir's own rows are `ELIXIR_AVATAR_CROPS`, which win.
  Each of the five cards the first note named was rendered at 40px and
  96px against Elixir's art. Mirror (28000006) gets an Elixir row
  (`x 50, y 46, scale 1.3`): the default showed the card's outer border
  along the top. Musketeer, Mega Minion and Bandit, whose Drop art
  differs from Elixir's, still frame the face cleanly with Drop's rows,
  and Spirit Empress sits well in the default; those four are unchanged.

## For Drop (its own repository)

- Read `avatar` from `/me` and draw `art_url` with `crop`; its
  `img-src` CSP needs `https://elixir.poapkings.com`.
- Show the primary's `name` (the `players[]` entry with `is_primary`),
  escaped at output.
- Export its players' images as `{account_id, card_id}` pairs for the op.

MCP unchanged; JSON API 5.1.0. No migration.
