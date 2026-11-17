# 2026-11-17: A Ranked season's finish

The owner, 2026-11-17: "In general we were filtering a lot of things that
now a timeline would get value from. I like everything you highlighted
here. Feel free to change elixirs data engine as needed as well." and
"make sure to look in cr api docs as well for more info." This change
fixes the stale Ranked result the record filed at the season hour and
tells a followed player's finish on the timeline. MCP 13.8.0; the JSON API
is unchanged at 5.1.0.

## The fix: file a season only once the profile has rolled

cr-agent-api-docs (`players.md`, "The profile rolls per player") says each
profile rolls into the new season on its own clock, 44 minutes to days
after the season hour, and until it does `lastPathOfLegendSeasonResult` is
still the season before. `projectPolSeason` filed that result under the
season that had just closed whenever a read came after `ends_at`, so a
read in that gap wrote last month's league under this month.

The roll's mark is the progress map: the closed month's
`seasonal-trophy-road-YYYYMM` bucket is gone and a later month's is there
(`profileRolledPast`, `packages/ingest/src/snapshots.mjs`). Until then
nothing is filed. A rolled read upserts, so a row a pre-fix read filed is
corrected by the next daily profile read, silently.

## What is told

| Moment | Sentence | When (`at`) | Observed |
| --- | --- | --- | --- |
| `ranked_season_finished/1` | "Pip finished the Ranked season in Master III." ("in Ultimate Champion, rated 2,345") | the season's `ends_at` | the read that saw the roll |

Facts: `season`, `league`, `league_name`, `rating` (Ultimate Champion
only, the one rated league per `game-modes.md`; `null` below). Never the
global rank, which the ledger still keeps.

Said once, on the first rolled insert, and only when:

- the record read the player's profile before the season ended (a new
  follow brings no old season, and a deploy onto existing rows says
  nothing: corrections are updates, not inserts);
- the league is above Master I, or the record holds a Ranked
  (`pathOfLegend`) battle in the season: league 1 with 0 is also what a
  player who sat the season out reads.

`window_end` is the read time, so a poller whose pointer passed the
season hour still sees it; `occurred_at` is the season's end, so a late
roll never lands at the top of a feed.

## Where it travels

- **Player timelines and the web feed:** yes, a small moment (a run of
  them groups into one row). Kicker "Ranked season", title the league.
- **Clan timelines:** no. Every member's finish would land on one instant
  each month; the clan feed keeps member moments but not this one
  (`CLAN_MEMBER_MOMENT_KINDS`).
- **Digest:** yes, in the week's big-first kinds.
- **Discord:** no; not an `ACTIVITY_CATEGORIES` kind. The clan-engine
  story clause exists for completeness.
- **Bell, push:** as player moments generally.

## Also fixed: a player whose only items were moments was "quiet"

`buildTimeline` decided `said` from a player's entry facts, not the
moment items, so a player whose window held only a moment (a maxed card,
a King Tower level, a deck switch, now a season finish) was listed in
`quiet` and the item dropped. It now counts moment items too.

## Follow-up from #1110: deck switch observed at the read

Codex on #1110: `deck_switched` set `window_end` to the third battle's
time, so a poller whose pointer had passed that battle before the read
never saw it. `detectDeckSwitches` now takes the read time (`fetchedAt`)
and uses it as `window_end` when later.

## What a deploy does

No migration. The next daily profile read of each followed player files
October's (or the current closed season's) row only if the profile has
rolled, correcting a stale row silently. No moment is written for a
season that closed before a player's first post-deploy rolled read
unless that row was never filed and the player was watched before the
season ended; for 2026-10 most rows already exist, so the deploy is
quiet. The first moments arrive at the December season close.

## Product calls left open

- A clan roll-up ("12 members finished the season; 3 in Champion") on
  the clan feed instead of nothing.
- Whether Master I with Ranked play is worth saying at all.
