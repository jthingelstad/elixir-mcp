# 2026-11-13 — The King Tower stands in the middle

Jamie: the King Tower "is always in the middle between the two princess
towers... we should show it the same way." Every surface that draws a
battle's tower tiles now orders them Princess, King, Princess on both
sides: the battle page's "How it ended" (one panel per game on a duel,
the same `Towers` component in `apps/web/src/views/Battle.jsx`) and the
share picture (`services/web-api/src/share-image.mjs`, which also draws a
shared highlight's `/h/<id>.png`). No other surface draws tower tiles:
Home's session games, a shared post's side-by-side and mail show at most a
hitpoints total.

Layout only. The projection, the JSON API and MCP are unchanged. The
Princess Towers keep the stored order (first left, second right), and the
King always takes the middle slot: a side whose record lacks a value
draws all three tiles, the missing one as not recorded ("—"), never an
invented value. A side with no tower state still says so in one line. The
King tile is a touch heavier, flat: a hairline edge (`--line-soft`) and a
brighter label (`--ink-dim`) on the page, the firmer line and dim label on
the picture. Phone width holds at 390 px.

The duel King that reads "—": `battle_participant_round.king_tower_hp` is
null for that game because the payload has no `kingTowerHitPoints` in a
round where the opponent took three crowns. The reference says so
(`cr-agent-api-docs/models/battles.md`, duel rounds: absent, not `0`, in
all 108 such rounds of a one-clan sample); the participant-level field is
the one sent as `0`. Ingest stores the absence as null and the projection
passes it on, so the page shows "not recorded", not "destroyed". The
anonymized duel fixtures hold no three-crown round, so nothing in the repo
proves a projection drop, and none was changed.

Tests: `services/web-api/test/share-image.test.mjs` reads the tiles' order
and values from the drawn SVG (including a missing King and a single
Princess value); `apps/web/test/battle-duel-decks.test.jsx` reads the
page's tiles for a duel game whose King value is missing.
