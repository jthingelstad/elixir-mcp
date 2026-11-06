# Redesign follow-ups, 2026-11-06

The list left after the flip.

- **Timeline order.** Sittings sorted on `sort_at` (last battle) but showed `at` (first battle), so rows read out of order. `at_unix` and `local` now name `sort_at`; `at` keeps its meaning, since story identity and `facts` lean on it. Web readers and syndication's sorts use `sort_at`. MCP 11.17.0.
- **The tab mark.** `signals.timeline_pending` counts subjects polled since the page's place, so it lit on any poll and could never agree with the New chip. Home's tab now asks `GET /api/me/timeline?news=1`, one statement (`timelineNews`), and shows a plain mark. `timelineNews` is a superset by design, so a mark can rarely clear on opening with nothing marked new. The real count takes the feed to build and stays on the page. `timeline_pending` stays for the agent rail. [engineering, 2026-11-06]
- **Nicknames in moments.** The Home route, for the account reading, swaps an in-game name that opens a moment for that account's nickname. The shared sentence, the timeline and mail are untouched. [engineering, 2026-11-06]
- **A first friend.** `addPlayer` made any first add the primary. Now a first add named friend or watching stays that. Home's Follow still refuses with no player of your own, since its ruling is that it asks first; MCP adds and says so in a note, because a refusal there would be a new refusal for existing callers. [engineering, 2026-11-06]
- **Games in place.** Evidence battles carry `opponents` from the record by in-game name. The row reads as the board does; a piece the record lacks is left out, never guessed.
- **A5.** "From the day recording began" was not what the code does. `recorded_since` is the earliest battle or daily reading held, and can predate `recording_active_since` when history was imported, and there is one reading per game day a read landed. Words corrected in Standing and the examples.
- **ISO weeks stay.** `clans_participation`'s weeks feed Standing's minimums and review boundaries, so moving them could change who is at risk or removed. See `docs/DECISIONS.md`. Between Monday 00:00 and 10:00 UTC, You here's `this_week` still reads the ISO week; that display could move without changing an outcome and belongs with Clan.
- **Dead code.** `FirstAnswer`'s full and summarized branches had no page; only the tracked player's record draws it.
