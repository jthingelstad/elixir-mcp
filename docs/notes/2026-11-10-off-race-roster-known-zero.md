# 2026-11-10 — A member left off the race is a known zero for awards

Feedback #388 (POAP KINGS, Action 106): the S138 week 1 award standings
said "War Champ: standings not ready". The week was recorded and
complete; one member, dormant since before the race began, was in the
clan at the finish with no `war_participation` row. The game seeds a
race's participants from members seen since it began
(`cr-agent-api-docs` `models/river-race.md`, "participants is seeded from
members seen since the race began"; `war_current` names them in
`members_not_in_race`), so `clans_participation` serves `null` for them,
and `missingPoints` in `clan-engine/src/awards.mjs` read that `null` as
unknown and held the points podium.

Points and decks accrue only to a listed participant, so such a member
scored nothing. `offRaceRoster` makes it a known zero when the week is
finished, someone has a row that week (the race was read) and the member
was in the clan at its finish (`in_clan_at_war_finish`). It applies to the
points podiums and to perfect attendance (zero decks, so short). A week
nobody has a row for, or a member whose place at the finish is unknown,
stays unknown. `weeklyAwardUpdates` now remaps `in_clan_at_war_finish`
with the other per-week columns.

Not changed: Clan's standing facts (`clan-engine/src/facts.mjs`
`weekDecks`) still read the same `null` as unknown war fidelity for a
dormant member; that is a separate change.

MCP 11.18.6 and JSON API unchanged; no migration.
