---
slug: timeline
title: "The timeline"
description: "What happened to the players and clans you follow, newest first: what the timeline is, where to read it, and how it reaches Discord. The elixir_timeline tool is on The timeline tool."
section: friends
order: 3
navTitle: "The timeline"
icon: bell
lede: "What happened to the players and clans you follow, newest first, written so a person can read it and an agent can act on it."
callout: ["Read it on Home", "/home", "Open Home"]
---

# The timeline

Most tools answer a question you asked. The timeline is the other
direction: it tells you what happened to the subjects you follow since you
last looked, newest first like a newsfeed, so a scheduled agent can read
one thing and decide what to consider, and so a person can read the same
thing and simply know.

An agent reads it with `elixir_timeline`. Its arguments, windows, items and
entries are on [The timeline tool](/docs/timeline-tool).

It is **synthesized when you read it**, from the record and what Elixir
keeps for each player and clan. Nothing is queued, fanned out or pruned. An
agent that comes back after a month gets a month's timeline (capped at 30 days,
and at the newest 150 items). Home's feed shows the last seven days, with
the same cap on items, thirty at a time, and reading it moves no pointer.
Home's week is the one exception to reading on demand: it is built ahead and
kept, so Home opens at once (below).

## Home's feed

Home is your timeline as one feed, newest first, in days. Chips choose
whose items it shows: **Everyone**, **Friends** (the players you follow as
friends), **Clan** (the clans you follow), or **You** (your own players),
each with its count. A player you only watch is under Everyone. **All** or
**New** chooses between everything and what came since your last visit. The
chips only choose what the page draws.

Elixir builds your week ahead and keeps it, so Home opens at once instead of
reading seven days of everyone you follow while you wait. A kept week is
rebuilt every quarter hour while you use Home, so the newest battles can take
up to about twenty minutes to appear. A highlight, a cheer and your **New**
marker are always read live, and following or unfollowing someone, changing a
nickname or your time zone builds the week again on your next visit. While
you are away it is still rebuilt every two hours for a week, so a quiet day
or two never makes you wait; after more than a week away the first visit
builds it while you wait. Two pages opened at once share one build.

Your clan's card beside the feed is kept the same way: your standing, your
week and the war line are rebuilt in the background at most fifteen minutes
after you last saw them, so they can trail the record by up to about twenty
minutes. Whether you may see the card, your role, and the Actions waiting for
you are read live on every visit, and a role change, a policy change, a hold
or leaving the clan builds the card again at once. Otherwise Home shows the
kept card first and swaps in a fresh one when it is ready, so an older card
(up to a week) can show for a moment after a long break.

The feed shows the newest thirty items, and **More** reads the next thirty of
the same week, so an item never appears twice or goes missing between pages.
The counts on the chips are the whole week's; the chips filter what is
loaded. If the feed doesn't load (the read took too long or the connection
dropped), it says so and offers **Try again**. It never asks again on its own,
and the panels beside it read on regardless.

Your account's own items (a player or clan added, recording started or
stopped, a player no longer yours, an answer to your feedback) are not in
Home's feed: they are about your account, not anyone's play, so [the
bell](/docs/your-account#the-bell) tells them instead, a burst of them as
one line. Settings' Timeline page and `elixir_timeline` still carry them.

A sitting of battles shows its figures: battles, won, lost and, on Trophy
Road, the trophies it moved, with the deck it was played with most and in
how many of its battles. It carries a small bar chart, one bar per battle in
the order played: up for a win and down for a loss, as tall as the crown margin
(one to three). A draw is a flat tick, and a battle whose crowns the record
lacks is a short, faint bar. The same facts are written out for a screen
reader. **View games** opens the sitting's battles in place.

A moment links its battle when the record has one, with its result, score
and opponent; a highlight shows its player's own words. A clan's own line,
and a member joining, leaving or changing role, has a gold edge with the
clan's name above it. Every player's name opens their
[player page](/docs/player-page).

### Welcome to Elixir

Until you have done four things, Home opens with them above the feed:
**Welcome to Elixir, 2 of 4 done**. They are adding your player, verifying
it's you (one battle with a deck Elixir names), following a few people,
and choosing your [digest](/docs/email). Each step says what was done or
links to where you do it, and is worked out from your account each time
you open Home. Following one player completes the follow step. Choosing
your digest is picking Daily or Weekly, or turning it off, in Settings ›
Emails; picking Weekly counts even though it is the default, and so does
turning it off. Once all four are done the steps are gone for good: Elixir
notes that you finished, so unfollowing everyone later does not bring them
back.

### Beside the feed

On a wide screen three panels sit beside the feed; on a phone they follow
it. Each reads on its own, so the feed never waits for them.

- **Your week:** your own battles this week, by mode, with your trophies
  and the deck you played most, and how many cheers other people gave the
  items about you since Monday. Facts only.
- **Your clan:** your player's clan, with **This week's race** while a
  river race runs ("Season 137, week 2, war day 2: 2nd by fame, 8,200
  fame", or training days, or finished), the last race's place, and your
  war decks and donations this week.
- **People to follow:** up to five players, each with why they are there
  as a fact and what following them costs. They come in turn from three
  places: players your own players met in the last seven days (twice or
  more, or as a 2v2 teammate: "You played them twice this week"), your
  clan's members ("In your clan"), and players followed by the verified
  players you follow ("Followed by Ada, who you follow"). Players you
  already follow, watch or own are never suggested. Nobody is ranked by
  trophies, wins or any rating, and names are game names, never a
  nickname. **Find more people** opens [Find](/docs/follow-a-friend#find).

## Cheers

Any item about a player or clan you follow can take a cheer from you, one
of six that celebrate: 👏 **Well played**, 🔥 **On fire**, 👑 **Royal**,
😮 **Wow**, 😂 **Ha** and 💪 **Grind**. There is nothing to boo with. You
give one cheer per item: another cheer changes yours, and tapping yours
again takes it back. **Cheer** under the item opens the six.

An item shows its cheers as counts, each with its number, and says how many
cheered in words ("You and 2 others", "3 people"): never who. Every member
whose feed shows the item sees the same counts. Your account's own items
(a sign-in, a feedback answer) take no cheers.

The same item takes cheers on a [player's page](/docs/player-page) and on
its battle's page ([Battles](/docs/battles#cheers)), with the same counts,
but only while it is in your own feed: an item from the last seven days
about a player or clan you follow. An item older than that, or about
someone you do not follow, shows no cheers and no counts there. A battle's
page signed out shows neither.

A cheer stays in Elixir. It goes to no Discord channel or mail, and
`elixir_timeline` does not carry it; an agent cannot cheer. Your own agent
can read the counts on the items about your primary player with the MCP
tool `elixir_cheers` (`GET /api/v1/me/cheers`), reading as you: for each
cheered item in the window its id, kind, time, sentence and counts by
kind, never who, and never your own cheer. The bell
counts the cheers on items about your own verified players, never naming
who ([the bell](/docs/your-account#the-bell)). You can give
up to 120 cheers an hour.

## Your RSS link

Your timeline can also be read in a feed reader app. **Settings ›
Connections & agents › Your RSS link** makes one private link for your
account: it opens your own timeline, everyone you follow together, the last
seven days and at most 50 items, newest first.

- **The link is its own key.** Anyone holding it reads your timeline with
  no sign-in, so keep it like a password. Elixir keeps only a fingerprint of
  it, so it is shown once, when you make it: copy it then.
- **Reset** makes a new link and stops the old one at once; **Turn off**
  ends it. Closing your account ends it too.
- **What it carries:** each item's words with players by their game names,
  a link to the battle or the player, and when. Never your nicknames for
  players, your email, your account's own items, leaders-only facts or
  cheers.
- A feed reader may read it up to 60 times an hour.

## Highlights

A highlight is a battle a player chose to put on their timeline, with their
own words: the timeline's one item about a single battle. Only a person whose
verified player played the battle can post it, from the battle's page
([Highlight a battle](/docs/battles#highlight-a-battle)). Everyone who follows
the player reads it in their timeline, with a link to the battle. Its owner's
timeline also carries the post's share link once they have shared it; nobody
else's does. A deleted highlight leaves every timeline.

Your own agent reads the highlights a player posted, newest first, with the
MCP tool `players_highlights` (`GET /api/v1/players/{tag}/highlights`):
each one's sentence, the words written with it and the battle's link. It
reads them as you, its owner; an integration key reads none of them, and an
agent never posts or deletes one.

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
  way, and so does a highlight when it is posted or its words change.
  A quiet rung crossed by the clock posts with the next thing the
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
  battles, or closes, or a highlight's words change), its message is
  edited in place; a sitting posted while going is edited to its final
  count within about 45 minutes of its last battle. A message deleted
  in the channel stays deleted, and a line already posted stays when
  its item leaves the timeline (a highlight deleted on Elixir). A
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
- **It never passes a person's word off as the game's.** An attested fact
  (section `attested`) is what a person said in Clan or through a family
  app, and says so in `attested_by`; the game's own record of the same moment
  (`member_left`, `member_role_changed`) stays beside it, raw.
- **It never assumes what the reader is for.** The same items serve a
  clan-management routine, a highlights bot, a recruiter watching churn, a
  war-only agent, and a person reading the website. Each reads the sections
  it cares about.
- **It never changes for the mail.** The mail chooses what to say from
  it: the digest tells only the big firsts (a legendary badge among
  them), counts card unlocks and badge levels rather than listing them,
  tells each player once, and draws a clan's own news as a headline and
  its next three facts ([Email](/docs/email#your-digest)). The timeline itself keeps every item, newest
  first.
