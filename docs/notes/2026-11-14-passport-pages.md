# 2026-11-14 — Passport pages and the Stamp mark

No MCP tool, `/api/v1` operation, contract version or migration changes.
One field is added to the app's own `GET /api/player` read (#1015, build
slice 2 and the page half of slice 5).

## What Elixir does now

- **The Stamp mark** is a kit part (`packages/ui/src/Stamp.tsx`, styles in
  `packages/design`). An earned mark is filled with its ink, tilted, and
  carries its name and day ("Before" over the day for a legacy grant). An
  unearned mark is an untilted outline reading "Elixir", with "Not earned"
  or "Optional" under the tile. So the two differ in shape and words, not
  colour alone. Every level of a ladder wears the Stamp's one ink; a level
  is the numeral in its name (II, III). Gold stays for verification and the
  brand. The glyph is a Lucide icon through `Icon`; no image, no bitmap
  text, no game art.
- **`/home/passport`** is the owner's passport, read from
  `GET /api/me/passport`. **`/home/passport/<id>`** is any member's, read
  from `GET /api/passports/<id>`, which carries the public projection only,
  so the page has nothing else to show. The page groups Stamps as the
  catalog does: two columns on the smallest phones, three when there is
  room.
- **The detail sheet** is the kit's `DetailSheet` (a native modal dialog):
  Escape closes it, focus stays in it, and focus goes back to the tile on
  close, also when the sheet opened from a link. `?stamp=<stamp_id>` opens
  one Stamp (`passportHref(null, id)` in `apps/web/src/lib/passport.js`);
  opening and closing replace the address, so Back leaves the passport. The
  owner's sheet adds the exact count and a link to where the Stamp is
  earned; nobody else's does. On the Map says it shows no place and opens
  no map.
- **The identity header** uses the canonical `Avatar`, `PlayerName` and
  verification mark: gold only while `player.verified` is true, "Player not
  verified" otherwise, and the account icon with the display name when
  there is no player.
- **Loading** shows a status line and blank tiles, never "0 Stamps". A
  failed read shows the kit's retry. An unknown id says the link may be
  mistyped.
- **Entry points:** Passport in the account menu (every account), a row on
  You, and a "You in Elixir" panel first on Settings > Profile with the
  identity and a passport preview. Profile's Main player uses `PlayerName`
  with its verified state. There is no sixth tab.
- **`GET /api/player`** gains `passport: {id, count, marks} | null`.
  `readPlayerPassport` (`packages/stamps/src/summary.mjs`) finds the
  player's canonical verified owner with the same rule as the player
  page's verified account, so a verified main and a verified alt name the
  same passport. An unverified claim, a player nobody holds and an owner
  with no passport give `null`; the read writes nothing. It is one
  statement, and the route's signed-in budget goes from 30 to 31. Its
  earned rows pass through the public projection's own `publicEarned`, and
  its privacy test uses the same forbidden list as the projection's
  (`services/web-api/test/passport-privacy.mjs`).

## Open

- `summary.mjs` reads the 0269 tables beside `store.mjs`, which is the
  earning side's file. It may move into the store when that side settles.
- Nothing writes Stamps yet, so live passports show only what the store
  holds. The bell can link a new Stamp with `passportHref(null, stampId)`.
- No analytics events for the passport.
- `/home/passport/<id>` sits under Find in the bottom bar; your own
  passport sits under You.
