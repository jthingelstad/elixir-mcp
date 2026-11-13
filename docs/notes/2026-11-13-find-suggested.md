# 2026-11-13 — Find opens on Suggested

No MCP tool, `/api/v1` operation, contract version or migration changes.
What's new 240.

Jamie, 2026-11-13: Find "lands you on a search that ONLY works by player
tag and is essnetially a dead end... give me a list to just click on of
suggested follows and give me a line on why 'you played a friendly',
'[a friend] follows them'".

## What changed

- **Suggested** is Find's first tab and where it opens, for every account
  (`apps/web/src/home/Find.jsx`, `FindSuggested` in `People.jsx`).
- `GET /api/me/people/find` (`findPeople` in
  `services/web-api/src/people.mjs`) is the same `suggest` that Home's
  People to follow uses, over 30 days and up to 30 players: friendly-battle
  opponents, 2v2 teammates and players met twice or more; the players
  followed by the accounts that verified the players you follow ("Ada
  follows them"); and your clan, taking turns. One implementation for
  three surfaces: Home's panel (`suggestedPeople`), Find (`findPeople`)
  and Home's starter set (`starterSet`) read `peopleSources`.
- Each row: game name, why as a fact, what following costs, and the one
  confirmed, priced Follow. Ten show, then **Show more**; `more` counts the
  rest the sources held, and the list then points to From your battles and
  Your clan.
- Nobody to suggest: one panel that says what fills it, with **Search by
  name or tag** (the sheet) and **Send your Follow me link** (the Your
  link tab, with a player of your own).

## Was Find's search tag-only?

No, though it looked it. The search sheet (the button on Find's Search
tab and on every page) already found players by name through
`players_search` (the names Elixir has seen, its own players and
everyone they met), as well as clans, cards and help. Find opened on
the Search tab, whose own form was a bare `#TAG` box labelled "Follow a
friend", which read as the only way in. The form is now **Follow by
player tag**, Search is no longer the landing tab, and the docs say what
the sheet searches.

## The read

`services/web-api/test/people-budget.test.mjs` holds
`/api/me/people/find` to 11 statements on the seeded clan (about 1,031
shared buffers), with the same plan rules as the other people reads: no
Seq Scan on `battle`, `battle_participant` or `player`, no more than a
quarter of one read, no `player_tag = any(...)`.
