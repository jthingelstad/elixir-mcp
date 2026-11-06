---
slug: timeline
title: "The timeline"
description: "What happened to the players and clans you track, newest first: what the timeline is, where to read it, and how it reaches Discord. The elixir_timeline tool is on The timeline tool."
section: friends
order: 3
navTitle: "The timeline"
icon: bell
lede: "What happened to the players and clans you track, newest first, written so a person can read it and an agent can act on it."
callout: ["Open it at Home › Timeline", "/home/timeline", "Open Timeline"]
---

# The timeline

Most tools answer a question you asked. The timeline is the other
direction: it tells you what happened to the subjects you track since you
last looked, newest first like a newsfeed, so a scheduled agent can read
one thing and decide what to consider, and so a person can read the same
thing and simply know.

An agent reads it with `elixir_timeline`. Its arguments, windows, items and
entries are on [The timeline tool](/docs/timeline-tool).

It is **synthesized when you read it**, from the record and what Elixir
keeps for each player and clan. Nothing is queued, fanned out or pruned. An
agent that comes back after a month gets a month's timeline (capped at 30 days,
and at the newest 150 items). Home's Timeline shows the last seven days, with
the same cap on items, and reading it moves no pointer.

## Cross-posting to Discord

Your own timeline's sharing is **Timeline to Discord**, on Settings › Connections & agents › Discord. For an agent,
**Manage sharing** on that agent's Timeline opens the same settings in a drawer, and closing it discards unsaved edits. Only the account
owner can save changes, on the website, never MCP or the JSON API.
Delivery history expands there; an agent's events and evidence stay on the
page. Connections and agent pages show whether sharing is on.

- **What posts.** Every `publishable` item the timeline holds for that
  account, not otherwise filtered: the same subjects, sections and kinds
  a scheduled agent reads. What is not publishable never leaves Elixir:
  an item only a clan's leaders may see (a member's away), and your
  account's own administration.
- **When.** About a minute after the record learns something about one
  of the subjects, the timeline is read from the cross-post's own place
  in it and anything new is posted. Nothing polls. An attested fact (a
  leader's word in Clan, a family app's record) wakes it the same
  way. A quiet rung crossed by the clock posts with the next thing the
  record learns about that subject. Nothing from before it was turned on
  is posted. The cross-post's place never moves your read pointer, a
  reader's, or `meta.timeline_pending`.
- **One line per item:** the item's sentence with names made literal,
  then links back to Elixir (the battle, the race week, the member, the
  subject), never previewed. Discord's post time says when; only an item
  over three hours old (a late proof, a quiet rung) adds how long ago
  (`<t:{at_unix}:R>`, from a sitting's last battle). Nothing pings
  anyone.
- **Edited, never repeated.** When an item grows (a sitting adds
  battles, or closes), its message is edited in place; a sitting posted
  while going is edited to its final count within about 45 minutes of
  its last battle. A message deleted in the channel stays deleted. A
  post whose answer from Discord is lost is never sent again: a missing
  line beats a duplicate.
- **The webhook.** Only Discord's own webhook address is accepted;
  saving one posts a first line so you can see it works. It may end in
  `?thread_id=` and a thread's id, to post into that thread. A forum
  channel's is refused (use a text channel's, or one thread's). Elixir
  keeps it sealed, shows it shortened, and never logs it. When Discord
  says it no longer exists, cross-posting turns off and the panel says
  why; turning it back on, or a new webhook, starts from that moment.
- **When Discord refuses a line,** it alone is skipped. Lines go at most
  about 25 a minute, under Discord's limit, so a busy war day takes a
  few minutes; a line still undelivered after many tries counts as not
  delivered.
- **The last deliveries.** The panel lists the last 20 lines of the past
  30 days (posted, edited, refused in Discord's words, not delivered, or
  "no answer") and counts those not delivered. Rate a posted line 👍 or 👎,
  with a note: feedback to Elixir, which cannot see your channel.

A clan's leaders can also post the clan's own activity to a channel,
chosen by category and set by the clan's policy, from Clan's
Run › Discord ([The clan's activity in
Discord](/docs/clan-discord#the-clans-activity-in-discord)). The panel
names each clan you follow that does, with one of your verified players
in it: what it tells is in your timeline too, so a server carrying both
channels tells it twice.

## What the timeline never does

- **It never tells you what time it is.** A war day opening or closing is a
  clock fact; `game_clock` carries `war_day_closes_at`,
  `next_war_day_opens_at`, `next_training_starts_at` and `week_ends_at` so a
  routine that cares schedules itself.
- **It never gives advice.** "Passed 10 quiet days on the record" is a fact with a
  disclosed rung; whether that means anything is the reader's call. The same
  goes for a standout session: `crossed` names the rung, the reader decides
  whether five wins in a row is news in this clan.
- **It never passes an app's word off as the game's.** An attested fact
  (section `attested`) is what a person said through a family app, and
  says so in `attested_by`; the game's own record of the same moment
  (`member_left`, `member_role_changed`) stays beside it, raw.
- **It never assumes what the reader is for.** The same items serve a
  clan-management routine, a highlights bot, a recruiter watching churn, a
  war-only agent, and a person reading the website. Each reads the sections
  it cares about.
- **It never changes for the mail.** The mail chooses what to say from
  it: the milestone email sends only the big firsts (a legendary badge
  among them), the weekly emails count card unlocks and badge levels
  rather than listing them, and the friends
  email draws a clan's summary as a headline and its next three clauses
  ([Email](/docs/email)). The timeline itself keeps every item, newest
  first.
