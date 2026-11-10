# 2026-11-09 — Home and the timeline: the clan's learned count probes, Friends reads one deck once

Home's Latest panel read 2.1-2.2 s warm on the heaviest account (build
8376b496, 2026-11-09), against the 2000 ms p95 ceiling in
`infra/web-latency-ceilings.json`; Friends took 3.1 s. Diagnosed
read-only with `{explain_timeline}` over that account's seven days
(13 subjects; 3.4 s elapsed, 2.9 s of it in the database) and the
panels' own `home_panel` and `latest_parts` lines.

## Where the time went

- **`clan.learned`, 0.5-0.7 s per seven-day build.** For the big clan
  the planner hashed the window's 3,928 battles and ran a parallel Seq
  Scan of all of `battle_participant` (about 222,000 rows, 98,000 of them
  the clan's) to join them, reading 1,718 pages from disk (620 ms of
  I/O). A Seq Scan through the ring buffer never warms the cache, so
  every read paid it again, and it competed for the disk with the Clan
  panel reading beside it. The two small clans already took index plans
  at about 1 ms. Same cause as #737.
- **Friends: one tool call per card it did not need.** For each friend
  drawn as a card, `personWeek` asked `battles_decks` for the top deck,
  then asked it again by `deck_hash` for the cards, rerunning the
  window's whole deck aggregate to read one deck's identity. Up to ten
  cards, so up to ten extra aggregates per read; Home's own week panel
  already dropped the same second call on 2026-11-06.

## What changed

- **`clanLearnedQuery`, observed basis** (`packages/tools/src/activity/entries.mjs`):
  the window's battles come off `battle.created_at`, and each probes its
  own participants by primary key for one in the clan
  (`cross join lateral (... limit 1)`), so a battle counts once without
  `count(distinct)`, and the clan's whole history is never read. The
  occurred basis (Friends and ad hoc reads) keeps the clan's own
  `(clan_tag, battle_time)` range, which was already an index plan.
  `packages/tools/test/clan-learned-plan.test.mjs` compares it with the
  joined statement across five windows and four clans on a scratch
  database (both window edges, a battle with two members, a late
  capture, a member who played for another clan, a window with nothing),
  and pins the plan: an index probe of `battle_participant_pkey` per
  window battle, no Seq Scan anywhere.
- **Friends** (`packages/tools/src/friends-week.mjs`): the featured
  deck's cards, form, tower troop and archetype come from
  `deckIdentities`, the helper `battles_decks` itself reads for one
  deck, so the deck is the same object; two tool calls a card, not
  three. The Wednesday mail shares the builder and draws the same deck.
  `services/web-api/test/home.test.mjs` compares the new deck with the
  one the third call drew, and counts the calls.

Every reader's answer is unchanged: the same counts, items, order, cap
and `timeline_more`. Freshness is unchanged: every read still computes
from the record. No MCP contract or `/api/v1` change, no new metric.

## Expected after the deploy

Latest and the timeline page lose the 0.5-0.7 s of `clan.learned` and
its disk reads: about 1.5 s warm, under the ceiling. `elixir_timeline`
loses the same per call, more over longer windows. Friends loses up to
ten deck aggregates. The Clan panel (`clans_participation` 375 ms and
`war_history` 81 ms in `{profile_tool}` after #737) should fall with the
disk contention gone. Read it back with `npm run web-latency -- --days
1` (Home by build) and `{explain_timeline}` for the account over seven
days: no Seq Scan in the big clan's `learned` plan.

## No stored feed

A stored timeline feed is not needed while the ceiling is met by plans
and indexes; it would trade freshness and a second source of truth for
speed the reads already have. If a read is over its ceiling after this,
the next candidates are `clan.sitting_details` (447 ms) and
`player.battles` (379 ms) in the same `{explain_timeline}`.
