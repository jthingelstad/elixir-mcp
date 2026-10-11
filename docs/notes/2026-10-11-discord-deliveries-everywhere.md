# 2026-10-11: the last Discord deliveries on the timeline and the clan's activity pages

This is the third of three changes from the Discord delivery plan Jamie approved on 2026-10-11. The first two were #483 and #485 (the timeline's relay) and #488 (Clan's Actions). The relay has written each webhook's delivery history since #483 (`timeline-discord-state/<id>/history.json`, the contracts' `addDiscordDeliveries`). This change shows that history on the two pages that set those webhooks up.

- **Read beside the status.** Syndication's `makeHistoryReader` reads the history the same way `makeStatusReader` reads the status. Web-api already has get on `timeline-discord-state/*`, so no IAM change is needed.
- **One view.** `settingView` and `clanActivityRowView` now return `deliveries` and `not_delivered` (through `deliveriesView`).
- **One list.** Both pages render the UI kit's `DiscordDeliveries`, the list Clan's Actions use. A timeline item's id is not shown; an Action's number is.
- **The text as posted.** The excerpt limit rises from 160 to 500 characters, so a line reads whole. The activity page shows it whole.
- **The rewritten mark.** A clan's line that its own model wrote carries `rewritten` from clan-sync through the outbox message (an optional boolean, validated) into its delivery, and the page marks it. This covers plan item 6, "store the posted text and a rewritten flag", without a migration. The posted text and the flag live in the relay's bounded history (20 entries, 30 days) rather than in `clan_activity_discord_told`. Of clan-sync, only the post's shape changes, by one field.
- **The overlap.** `clanChannelsInTimeline` (syndication) looks for clans that have their activity channel on, that the account follows with notify on, and that one of the account's verified players is a member of now. The timeline page names any it finds: their lines reach Discord twice when a server carries both channels.
  - Nothing is filtered (Jamie, 2026-10-10).
  - The check is limited to the person's own clans, because whether another clan posts its activity is that clan's business.

Unchanged: no embeds, no filtering, and a post whose outcome is unknown is never made again. No migration, no MCP or JSON API move, no tool change.

Review (#490): the list shows all 20 entries the history keeps (the kit's default was 8, on the Actions page too), and the timeline page names every clan that overlaps, with no limit of five.
