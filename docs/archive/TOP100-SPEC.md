> **ARCHIVED 2026-09-25** — the Top 100 mail's pre-build product spec from Jamie's handoff bundle; the reviewed and built design differs (the mail is a default-on switch on every beta account with one-click unsubscribe, not an opt-in list; the builder computes and the editor Lambda writes). Superseded by `docs/EMAIL.md` (`top_100`) and <https://elixir.poapkings.com/docs/email>. Moved from `docs/top100/SPEC.md`.

# Elixir Weekly — spec

## What this is

A weekly email about the global Path of Legends top 100, generated from the
Elixir MCP record. Opt-in list. One shared edition per issue.

## What it is for

Signups. The pitch is not "here are stats" — anyone can read a leaderboard.
The pitch is **memory**: the game shows you today, Elixir shows the
trajectory, the form-aware deck identity, and the level-gap context.

Every section must carry at least one number that is impossible to get from
the game client or from a stateless API wrapper. A section that fails that
test is a section a competitor can reproduce.

The conversion argument, stated as a fact rather than a pitch:
**your history starts the day you track your tag.** Someone who connects today
has a month of their own history in a month. Someone who waits has nothing.

Secondary pitch, specific to the audience: Elixir is an MCP service, so each
issue ends with questions a reader can paste into their own agent. The
newsletter doubles as documentation.

## Cadence

Weekly. Enough movement for a real narrative, matches the war and season
rhythm, and keeps generation cost to ~52 issues a year.

Rejected: daily (thin stories, movers section becomes noise, 30x cost for an
audience that will not open daily).

Planned addition: a season-reset special, triggered automatically. High
interest, and "who held up across the whole season" is a pure history play.

## Issue structure

| # | Section | Target | Source |
|---|---|---|---|
| 1 | Subject lines | 5 options | derived |
| 2 | Cold open | ≤35 words | derived |
| 3 | The podium | ~150 words | board + as_of board |
| 4 | Biggest climbers | table, 5 rows | movers.up |
| 5 | Biggest drops | table, 5 rows | movers.down, movers.exited |
| 6 | The deep cut | ~120 words | deep_cut |
| 7 | The meta | ~180 words | meta |
| 8 | Ask your own agent | 3 lines | static pattern |
| 9 | CTA | 2 sentences | static |
| 10 | Footer | short | coverage + disclaimer |

Prose ceiling: 700 words excluding tables and footer.

## Editorial rules that carry the product

**Rank delta and rating delta always travel together.** A 30-point gain can
move a player 200 places in a compressed field, and a player can gain 300
rating and still fall 89 places. Rank alone is misleading in both directions.
This pairing is the editorial signature.

**When every player on the drop list gained rating, say so.** In a filling
season, standing still is losing ground. This is the single best recurring
insight available, it is counterintuitive, and it requires stored history.

**Season age changes the framing.** In the first ~10 days of a season the
board inflates several hundred points and rank swings are noise. Lead on
rating, treat rank as secondary, and tell the reader the board is filling.
After that, rank leads.

**The deep cut is built from a contradiction.** "The weekly number says X, the
daily record says Y." Repeatable template, and it states the pitch as a fact.

Deep cut types, rotating:

- `spike_hidden_by_weekly` — a player's week-over-week delta conceals a run at
  the top. The strongest version of the template.
- `deck_churn` — how many of the top 100 changed decks this week.
- `head_to_head` — who actually beats whom at the top.
- `session_pattern` — streak lengths, when the top 100 grind.

## Novelty bar

Per section. Used both to decide the deep cut and to trigger drought mode.

- podium: rank 1 changed, or a podium player moved 20+ places
- climbers: top climber moved 50+ places
- drops: top faller moved 40+ places, or someone exited from a top-20 place
- meta: a shared deck across 2+ top-100 players, or rising card share moved 5+
  points
- deep cut: selected by the collector, always clears

Fewer than 3 sections clearing → drought mode. Do not pad: shrink the tables,
expand the deep cut to ~250 words.

## Voice

Plain declarative sentences. No exclamation marks, no rhetorical questions, no
second-person hype. Do not address readers as "folks", "legends" or "kings".
An analyst writing an internal memo that happens to be readable by outsiders.

## Risks

- **List acquisition.** The Clash Royale API carries no email addresses. The
  top 100 themselves cannot be mailed. Opt-in signup only.
- **Supercell fan content policy.** Disclaimer in every footer, no implication
  of endorsement, care if paid membership is ever attached.
- **Naming individuals.** Public leaderboard data, but framing matters.
  "Biggest drops", never "biggest losers". Analytical tone toward anyone named
  repeatedly.
- **Freshness.** Tool output carries freshness seconds. A plain "data as of"
  line beats letting a stale snapshot read as live.
- **Story drought.** Some weeks nothing happens. Handled by the fallback
  above, decided in the generator, not by hand.
