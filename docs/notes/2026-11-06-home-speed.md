# 2026-11-06: Home reads panel by panel

Production logs showed `GET /api/me/home` at 4.8 s to 18.4 s on an account with
13 tracked players and 3 clans, and twice past the 18.5 s soft deadline, where
the 504 took all of Home with it. One request ran first answer, clan, week and
latest in series on one client.

## The split

- `GET /api/me/home`: `{ first }`. All the first paint waits for: who you are,
  new account or not.
- `GET /api/me/home/clan`, `/week`, `/latest`: `{ clan }`, `{ week }`,
  `{ latest }`. The app asks only once the head says the player is recorded, so
  a new account reads no panel.
- `/week` is the opening mode with no `mode`, as a chip's read with one.

All under the existing `/api/*` behaviour; no new CloudFront behaviour.
The app's internal API, so no contract change.

## Charges

One visit still spends one charge on `mcp#<account>`, the hourly bucket `/mcp`
and Explore share: the head's. The panels and a chip count on `home#<account>`
at three times that limit, the same number of visits an hour. These reads spend
no daily budget either way: the budget is the MCP door's alone (#538).

## What changed inside the reads

Measured locally by counting statements on the request's client, on a scratch
database with 45,000 seeded battles. A Mac with a cached local Postgres says
nothing about production's milliseconds, so the counts are the finding, not
the times. A tool's statement count includes its budget's `set_config`s.

| Read | Statements, 13 tracked players, 3 clans |
| --- | --- |
| Head | 7 |
| Clan | 116 (`war_history` 7, `clans_participation` 25, `clans_roster` 8 tool queries, each with budget) |
| Week | 95 (tool queries 34 and two direct, from 70 in five tool calls) |
| Latest | 200 (`buildTimeline`, about 11 per tracked player) |
| Friends | 159 |

- `players_summary` is gone from the week. The panel drew only its `trophies`
  and paid for a 30-day record and two deck rankings (20 tool queries). The same
  row is now read directly.
- The second `battles_decks` is gone. It reran the window's aggregates to get
  one deck's cards; `deckIdentities` is what it reads them from.
- A week played in one mode alone skips the second `battles_performance`: the
  sample is that mode's, so the net is already in hand.
- `/week` reads the primary tag rather than the whole first answer.
- Friends reads the home clan alone rather than all of `myClans`.

`readWeek` stays in series. A request holds one lease on a pool of four, and
two environments are the most the endpoint scales to. A panel taking more
leases would compete with the panels it is meant to be independent of, on a
1 GB instance that swaps under heavy reads.

## Reading it

Each panel read logs `{"at":"home_panel","panel":...,"ms":...}`, and a failed one
`home_panel_failed` with its `code` and `ms`. The panels are `first_answer`,
`clan`, `week`, `latest` and `friends`. `request_id` on Clan's line for the
clan panel is now filled in: the handler passes the Lambda context to routes.

## Worth watching after the deploy

A visit now holds up to three leases at once for a moment rather than one for
the whole read, against a pool of `DB_POOL_MAX` 4 with `connectionTimeoutMillis`
2500. Connection-seconds do not grow, but the peak does. A request past that
waits 2.5 s and answers 503, which the app retries once. If `db_connect_failed`
shows up on these routes, the pool size is the lever.

## Defaults chosen in the build [engineering, 2026-11-06]

- The Needs you block takes no room until it has something to say, and opens
  over 180 ms when the clan read brings it late, so the panels below move down
  rather than jump. No motion under reduced motion.
- No chip is lit on Your week until the read says which mode it opens on.
- The clan row in Setup details stays blank until the clan read answers, rather
  than say "Not tracked yet" for a moment.
- The clan panel's Try again now refetches the clan read alone.
