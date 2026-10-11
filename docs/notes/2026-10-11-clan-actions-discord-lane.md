# 2026-10-11 — Clan's Actions in Discord: a lane of their own, in order, forums and a role

The second of three changes from the Discord delivery plan Jamie
approved on 2026-10-11, on Elixir Clan's Actions in a clan's Discord
(#406). The first (#483, #485) was the timeline's relay.

**Why only three posts, ever.** Read-only checks first: the relay logged
exactly three `clan_discord post ok` lines, on 2026-10-10 between 07:27
and 08:29 Central, and all three were the "connected" messages of the
three clans' webhooks. POAP KINGS' 52 Actions had all closed by
2026-10-09 (before its webhook was connected, so none was posted: a
closed Action is never posted), no Action has been raised since (the
10-11 morning run shared 0), and the other two clans are under the
member floor, so Clan raises nothing for them. Nothing was lost; the
post and edit paths had simply not run live. Two gaps showed in the
reading, and are fixed here: a reply was collected only at the clan's
next request or morning run, so a close could wait a day to be edited,
and a backlog over ten waited the same way.

- **A lane of their own.** `clan-discord/request/` notifies a new queue,
  `elixir-mcp-clan-discord` (one record a run, concurrency 2, 90 s
  visibility, dead letters to the mail's alarmed DLQ as before), instead
  of riding the mail's queue five at a time with no bound.
- **One request a clan, in order.** `share` collects the last hand-off's
  answers and hands over the next only when they are all in: every post
  and edit due, in Action number order, at most ten, as ONE request of
  `ops`. The relay takes them in order, 2.4 s apart (under ~30 a minute
  a channel), claims each before its call and records each answer as it
  comes (`reply/<id>.<n>`), so a relay that stops part way is picked up
  where it stopped: the op it was calling is unknown (never sent again),
  the ones after still go. A gone webhook or a long rate limit ends the
  run; the rest are `not_sent` and go in the next request. A 400 skips
  only its own Action, recorded with Discord's words.
- **A minute on, a look.** Each hand-off writes a wake for the timeline
  sync (`timeline-sync/clan-discord-<tag>.<minute>`, held a minute by
  that queue), which runs `share` under the clan's lock (skipping when
  another holder has it: Clan and the morning run share themselves). An
  unanswered hand-off is looked at again each minute for ten minutes. So
  a close is edited within a couple of minutes, and a 50-Action backlog
  arrives in about six. The jobs role gains `timeline-sync/*` put; the
  timeline sync's role gains `clan-discord/request/*` put and
  `clan-discord/reply/*` get and exact-key list (all in the stack).
- **#453, durable before sending.** `bridge.prepare` seals the request
  under a new id without writing it; the id is saved on its Actions;
  then `publish` writes it. A stop between the two leaves a request the
  relay never saw, answered unknown an hour on: never a second post.
- **Forums and threads.** Each post carries its Action's line as
  `thread_name`: on a forum channel Discord makes it a post of its own
  (the client retries with the name on Discord's 220001), the thread's
  id is kept, and the close is edited inside it (`?thread_id=`). The
  connect message is a forum post named "Elixir Clan Actions". A webhook
  ending in `?thread_id=` posts every Action into that thread. The
  connect's refusal now says Discord's words (`discord_refused`, 400)
  instead of "did not answer in time".
- **A role to mention, opt in.** `POST …/discord/mention { role_id }`
  (leaders) names one role; each Action's first post starts with
  `<@&id>` and allows only that role. Edits never mention anyone; every
  other Discord path keeps `parse: []`. DECISIONS records it.
- **The last deliveries.** `discord_log#<clan>` keeps the last 20 in 30
  days (posted, edited, refused with Discord's words, unknown, not
  delivered) with contracts' `addDiscordDeliveries`; Settings lists them
  with the count not delivered. The list is `DiscordDeliveries` in the
  UI kit, for the other two pages in the next change.
- **Small fixes.** The engine's escape now is the timeline's
  `escapeDiscord` (it missed `<` and `@`), kept in the engine and
  re-exported by syndication's lines. An older Action decided without a
  stored name reads "by a leader", never a raw tag.

Unchanged by design: no embeds; Actions name everyone and no clan; a
post whose outcome is unknown is never made again. No migration (the
clan's items are in `clan_state`), no MCP or JSON API move, no tool
change.
