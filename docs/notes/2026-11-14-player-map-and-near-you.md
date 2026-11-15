# 2026-11-14 — The player map and Near you (#768)

The last unbuilt part of the social layer. Jamie, 2026-11-14: city-level
location is fine for everyone, young players included; there is no legal
view to wait for, and the gate goes. Jamie, 2026-11-11: location is
opt-in and a city or zip at most; it places a person on a player map for
finding players in their region, and on their clans' maps.

## What shows now

- **Find › Near you**, after Suggested: the people on the player map in
  the reader's country and region, each as the player they verified, with
  "Plays near you, in <their city, else their region, else their
  country>" and a Follow priced like every other Find row. The reader's
  city first, then by game name and tag. No trophies, wins, score or
  distance. A reader with no place is asked to set one (Settings ›
  Profile › Your place); a reader on clan maps only sees the list, is
  told they are not on it, and can join.
- **The player map**, under Near you: everyone who chose it, a pin at
  the place each picked. The same Leaflet component, OpenStreetMap tiles
  and precision as the clan map (now `apps/web/src/components/PlaceMap.jsx`,
  shared). Signed-in approved people only: no anonymous page, nothing on
  MCP or `/api/v1`.
- **The picker** says who sees it, as a choice: "My clan maps, the player
  map and Near you" (a new place's default) or "My clan maps only".
- **Your place** says its reach and offers Join or Leave the player map;
  leaving keeps the place.
- **A place saved before today** asks once, under the place: "New: the
  player map", with Join the player map and Keep clan maps only. Until
  its owner answers it stays on clan maps only, and changing the place
  keeps it so (the picker preselects clan maps only).
- **What members see** says the player map and Near you reach a place
  only when its owner chose them.

## Decisions [engineering]

- **Region** is the same country and the same first-level region (state,
  province); a country with no regions in the lists is one region. Wide
  enough to find someone, never a distance.
- **Who appears:** approved person accounts whose place carries
  `player_map: true`, under a claim still verified (primary or alt), and
  written after that verification (a tag that moved never carries its
  old owner's place). One player a person: the primary when verified,
  else the earliest verified alt, so alts are never shown side by side.
  Near you leaves out the reader, any account whose players the reader
  claims (owns, follows or watches).
- **Consent:** `player_map` on the place item is true, false or absent.
  Absent means never asked: clan maps only. A save that leaves the flag
  out keeps what the place had, so an older page never widens anything.
  `PUT /api/clan/me/place/player-map {player_map}` joins or leaves without
  touching the place; it needs a place (404 `no_place`) and a verified
  player (403 `unverified`, as setting a place). Every write restamps
  `set_at` under every verified tag.
- **Precision:** the map's pins are `geo.resolve()` of the stored codes,
  exactly what the clan map sends; Near you sends a place's name only.
  Tested: every pin equals the resolved place, Near you carries no
  coordinate.
- **Reads:** `readPlayerMap` and `readNearYou` in
  `@elixir-mcp/auth/clan-context` (the seam's boundary test pins who calls
  them), one statement each, bounded (1,000 pins, 50 people, each with
  `truncated`). Migration 0275 adds a partial index on `clan_state` for
  places on the player map, by country and region; the plan test pins
  that neither read scans the ledger and that Near you reads only its
  region. Budget pins: Near you 7 statements, the map 4.
- **No contract bump:** these are app routes, not MCP or `/api/v1`.

## Product questions

- Whether the region should widen (neighbouring regions) when it is
  empty.
- Whether the player map should be its own page rather than under Near
  you.
