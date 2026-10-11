# 2026-10-11: a sitting cross-posted while open is edited closed

This is the other half of #454; #483 fixed the edit race. A sitting told to Discord while still open is re-read and edited by the next sync. Syncs are woken only by admissions, and a sitting closes when nothing more is admitted, so a quiet player's line could keep "still going" for good.

- **`wakeClosingSittings`** (syndication `wake.mjs`) finds accounts where all of these hold:
  - the cross-post is on;
  - a told row still has `open_from` within `OPEN_MS` (12 h, the sync's own reach for an open sitting);
  - that row was told more than 31 minutes ago (the timeline's 30-minute session gap and a minute for the read).

  Each such account gets one `timeline-sync` object, written once per quarter hour (`<account>.sitting.<slot>`). The sync then reads the sitting from its start, finds it closed and edits it, which clears `open_from`. A wake that still finds it open changes nothing.
- **The jobs Lambda runs it every five minutes**, through its own rule `elixir-mcp-discord-sittings` (`{"discord_sittings": true}`). The jobs role's `timeline-sync/*` put no longer depends on `ClanInternal`, since the timeline's cross-post is not Clan's.

It wakes only accounts that already have a line waiting to close, so it does not poll the timeline. Jamie's "event driven, not polling" (DECISIONS, the cross-post line) still holds for what gets posted: every new line still comes from an admission.

Worst case for one account is a wake every 15 minutes for up to 12 hours, if the record never shows the sitting closed.
