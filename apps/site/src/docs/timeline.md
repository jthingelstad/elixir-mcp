---
slug: timeline
title: "The timeline"
description: "What happened to the players and clans you follow, newest first: what the timeline is, where to read it, and how it reaches Discord. The elixir_timeline tool is on The timeline tool."
section: friends
order: 3
navTitle: "The timeline"
icon: bell
lede: "What happened to the players and clans you follow, newest first, written so a person can read it and an agent can act on it."
callout: ["Read it on your Timeline", "/timeline", "Open your Timeline"]
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
and at the newest 150 items). Your Timeline shows the last seven days, with
the same cap on items, thirty at a time, and reading it moves no pointer.
Your Timeline's week is the one exception to reading on demand: it is built
ahead and kept, so your Timeline opens at once (below).

## Your Timeline

Your Timeline is one feed, newest first, in days. Chips choose
whose items it shows: **Everyone**, **Close friends** (once you have
starred one, below), **Friends** (the players you follow as friends),
**Clan** (the clans you follow), or **You** (your own players), each with
its count. Questions shows its own count when selected. **All** or **New**
chooses between everything and what came since your last visit. The chips
only choose what the page draws: your place moves when you open the feed,
whichever chip is on, so **New** means the same under every chip. Your
choice is kept for your next visit on the same device.

**Questions** reads just the questions in your audience, before the pages
are cut, so a busy week of game activity cannot hide them. It works with
Mode: a question without a battle appears under **All modes**.

While the Timeline is open, **N new** tells you when new items are ready,
including new posts and questions from the people you follow. Tap it to
refresh when you are ready. Editing a post changes its words on refresh;
it does not count as another new post.

### By mode

The **Mode** list beside the chips chooses which game mode the feed
shows: **All modes** (the start), **Trophy Road**, **Ranked**, **War** or
**Casual**. It works with the chips, so **Friends** and **Ranked** shows
your friends' Ranked play.

- A session sits under each mode it was played in. A session with Trophy
  Road and Ranked battles shows under both.
- **Casual** is everything that isn't Trophy Road, Ranked or War:
  friendly battles, 2v2, party modes, challenges, events and
  tournaments.
- **War** is River Race battles and your clan's race results.
- A moment about one mode sits under it: a new Arena or best trophies
  under Trophy Road, a league up under Ranked, a challenge run under
  Casual. A post with a battle sits under that battle's mode.
- Things that aren't about one mode (badges, cards, levels, joining or
  leaving a clan, a post without a battle) show only under **All modes**.

The mode is in the page's address, so a link you share opens on it and
**Back** goes to the mode you had before. It is kept for your next visit
on the same device, like the chips. When a mode has nothing this week,
your Timeline says so and offers **Show all modes**.

### Your circle this week

Star a friend you follow and they are a **close friend**. Your circle sits
above the feed and shows how each close friend's week went since
Monday's reset (the same week as **Your week**): how many battles, on how
many days, how many sessions, and up to two things the timeline already
told about them. Tap a face to open their newest session, or their page
when they have none this week. **See all** opens the full list.

Facts only. Your circle is in order of who played last, never by how well
they played, and a friend with no battles this week just says "No battles
this week". Until you star someone, it offers a few players you already
follow, the ones who follow you back and your clanmates first, each with
a star to tap.

Only you see your stars. The friend is never told, and no page anyone else
reads, no follow list, no mail and no connected app shows them. Star or
unstar a friend on their page (the star beside **Following**), in
Settings › Players & following, or in your circle. Starring one Verified
player of an account stars all of that account's Verified players you
follow, because they are one follow.

Elixir builds your week ahead and keeps it, so your Timeline opens at once instead of
reading seven days of everyone you follow while you wait. A kept week is
rebuilt every quarter hour while you use your Timeline, so the newest battles can take
up to about twenty minutes to appear. A post, a cheer and your **New**
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
or leaving the clan builds the card again at once. Otherwise your Timeline shows the
kept card first and swaps in a fresh one when it is ready, so an older card
(up to a week) can show for a moment after a long break.

The feed shows the newest thirty items, and **More** reads the next thirty of
the same week, so an item never appears twice or goes missing between pages.
The counts on the chips are the whole week's, in the mode you chose; the
chips filter what is loaded. The **N new** button below counts every mode. If the feed doesn't load (the read took too long or the connection
dropped), it says so and offers **Try again**. It never asks again on its own,
and the panels beside it read on regardless.

Nothing in the feed moves while you read it. While your Timeline is open and on
screen, Elixir checks about once a minute (and when you come back to the
tab) whether your kept week has anything your feed doesn't, including a
battle recorded late that belongs further down.
When it does, a small **N new** button appears over the top of the feed,
staying in view as you scroll. Tap it to read the newest page again and
jump back to the top. Nothing is checked while the tab is hidden. A new
post isn't counted by the button; it shows the next time the feed is
read.

When your week has nothing in it, your Timeline says why as far as Elixir knows:
the players you follow have been quiet (none of them played a battle in
the last 7 days), Elixir is still catching up on some of them, or you
don't follow anyone yet. **Find your people** opens
[Find](/docs/follow-a-friend#find), and **People to follow** moves up
under that line, so a phone shows it before your week.

Your account's own items (a player or clan added, recording started or
stopped, a player no longer yours, an answer to your feedback) are not in
your Timeline: they are about your account, not anyone's play, so [the
bell](/docs/your-account#notifications) tells them instead, a burst of them as
one line. Settings' Timeline page and `elixir_timeline` still carry them.

A session of battles is a card. Its headline is what happened, like "Won 8
of 12 on Trophy Road, 5 in a row" (an event by its own name). Under it are
its figures: won, lost and, on Trophy Road, the trophies it moved. A small
bar chart shows one bar per battle in the order played: up for a win and
down for a loss, as tall as the crown margin (one to three). A draw is a flat
tick, and a battle whose crowns the record lacks is a short, faint bar. Chips
say how many wins took three crowns and the widest win. The deck played most
shows its eight cards, with how many battles it played, and the card names
the other decks the session switched to. Decks follow the same
[Evo, Hero and Wild display order](/docs/battles#deck-display) throughout Elixir.

Short sessions step back so the big ones stand out. A session of one or
two battles is one line: who, when, the result and its
trophies, and on the right its cheer button with how many gave that
cheer, a "+" count of every other cheer, and the smile that opens the
rest. Tap the line to open the
session's page. Two or more short sessions in a row, whoever played them,
fold into one row, such as "4 short sessions from Pip, Ash and 2 others",
with their battles, wins and losses, when, and how many cheers they have
between them. Tap it to open them in place, each as its own line. A cheer
always goes to one session: the folded row takes none itself, so open it
to cheer one. Nothing is moved: the feed stays newest first, and a folded
row never crosses the **New since your last visit** line.

A short session stays a card when it is more than a result: a close
friend's (their sessions never fold), one with a comment, one that
climbed a league or moved a rating in Ranked, a challenge run, or one
played with or against a player you follow.

Moments carry their art. A new card, a new Evo or Hero form and a Card
Mastery show that card's own art, never changed. A badge moment (a new
badge, a badge's new level, 12 wins in a challenge that raised the badge)
shows the badge's own art from the game, never changed either. Badge art
arrives as Elixir reads profiles: a badge level no profile it has read
carries yet shows the moment's usual mark until one does. A new Arena, a new league
in Ranked and a new best on Trophy Road read as the day's headline, with
a mark of their own: Elixir has no Arena art and draws none. A clan's line
wears the clan's mark on its band. A close friend's items show the small
star beside their name, which only you see.

Tap the card to open the session's own page. Back brings you here. It shows:

- the figures, the bar chart and the chips again;
- every deck played, with its cards and its count;
- every battle, newest first: its result and score, who was on the other
  side (tap a name for their page) and their deck, your teammate in a 2v2,
  a duel's games, the trophies it moved, the mode, the time, and
  **Battle**, which opens its page;
- facts that marked a battle, like **Three crowns**, **5th win in a row**,
  or a new best in trophies;
- **Post** on each battle when the session is your own verified
  player's, which opens the battle's page where you post about it.
- **Cheers**, under the figures and chips, with the same counts wherever you see the session in Elixir ([Cheers](#cheers)).

Only battles Elixir recorded are on the page. When the update counted more
than Elixir recorded, the page says how many are missing. A long session
comes 25 battles at a time, and a session older than 30 days has no page.

<a id="share-a-timeline-item"></a>

### Share a session

Tap the three connected dots on a Timeline item to **Share**. Elixir opens
your device's Share sheet or copies the link. You can share a public-safe update or any post
you can see, including someone else's question. A session's own page has
**Share this session** too. You do not need to write a post first.

The link opens one item: its game names, words and facts, with its cards,
deck or battle when it has them. It does not open a player's or clan's
Timeline or history. **Create an account** and **Sign in** invite the reader
into Elixir. Shared pages carry no comments, cheers, private nicknames,
account notices or private Clan state. Player names are plain game names.

Choose **Open item and comments** to read that exact update in Elixir. If you sign in or create an account, Elixir keeps that destination. The member page checks whether you can see the item now: a public shared copy does not grant access to its member conversation. A removed item or one outside your current audience shows no thread.

Choose **Follow** for its author or player, or choose players on a shared battle. Elixir shows the cost before you confirm. A shared battle opens its member battle page.

After the link is ready, **Share image** opens its picture and **Copy for a
post** copies a linked picture. A clipboard or Share sheet interruption
leaves the link available to select and copy.

While a link is active, every share of the same item gets the same random link. It names no sender
or opener. Elixir re-reads the current item when the link opens: edits show,
and a removed or hidden post stops opening. The link lasts while its source
can be read, up to a year. Session updates can be read for 30 days. Previous
public battle, session and post links no longer open. A member link from
mail, RSS or a notification asks you to sign in.

Shared pages ask search engines not to index or follow them. That is not a
privacy lock: anyone holding the link can open, copy or pass it along.

Each mode is told the way the game tells it:

- **Ranked** says the league you played in. A climb names the win that
  got you there ("climbed Master III to Champion"). In Ultimate Champion
  it shows your rating, from where you started to where you ended. A
  Ranked win below Ultimate Champion isn't counted as trophies.
- **Challenges** show their record and how many wins your run reached.
  An event's name is on one line, and a drafted deck has no archetype
  name, since you didn't pick it.
- **Played together.** A 2v2 names your teammate, and a friendly or
  clanmate battle names who you played, but only players Elixir already
  follows. Nobody else is ever named.

A moment links its battle when the record has one, with its result, score
and opponent; a post about a battle shows its player's own words. A clan's own line,
and a member joining, leaving or changing role, has a gold edge with the
clan's name above it. Every player's name opens their
[player page](/docs/player-page).

A player you follow brings their own clan news, even when you don't follow
their clan:

- **A promotion**, like "Pip was promoted from Member to Elder". A step
  down is only on the clan's timeline. Follow the clan too and you still
  see it once.
- **Their war week**, when the week closes: "Pip played all 16 war decks
  in Season 131, week 2, for 3,200 points." It's the whole week, never a
  day, and points, never fame. A week with no deck played says nothing.
  When several friends' weeks close together, they fold into one row.

### Getting set up

When you first add your player, **Your people** shows friends and
clanmates you can follow while your battles arrive. Elixir asks its
collectors for your missing first battle log even if your profile is
already on record. If it has just learned your clan and already follows
that clan for you, it can ask for the clan's missing roster too. These
reads share the recorder's rate budget, so a busy collector can take
longer. No one is followed until you choose and confirm.

**Finish your setup** keeps the other welcome steps available. After
following, your unticked choices stay in place and **Open Timeline** lets
you start reading without waiting for your own battles.

Until you're set up, your Timeline opens with the list above the feed:
**Getting set up, 2 of 6 done**. It shows the one step to do next, with the
Stamp it earns and a button to where you do it. Tap **See all steps** for
all six:

1. **Add your player.**
2. **Verify it's you**: one battle with a deck Elixir names. Earns the
   **Player verified** Stamp.
3. **Pick your picture**: a card, in Settings › Profile. Earns **Looking
   Good**.
4. **Follow someone who plays**: one player who has played in the last 7
   days. One friend is enough.
5. **Choose your email**: Weekly, Daily or Off for your
   [digest](/docs/email). Off counts too.
6. **Your place on the clan map**: tap **Set a place** and pick your
   country, region or city right there on your Timeline, or tap **Not now**. The
   picker says who sees it: your clan's verified members on the clan map,
   and anyone signed in to Elixir on the player map and in Near you. Both
   finish the step; only a place earns **On the Map**. You need no clan,
   and it works whether or not your clan's map is on. Before your player
   is verified, the step says to verify first. Change it later in
   [Your place](/docs/your-account#your-place).

All six earn the **All Set** Stamp. Adding another of your players and
connecting Discord are offered under the list. They earn Stamps of their
own and never count against it.

If the people you follow haven't played this week, the follow step says
so. If Elixir is still catching up on their battles, it says that instead,
and the step finishes once it sees a battle from the last 7 days.

Each step stays done once it's done, and the list goes for good once all
six are. Opening your Timeline also catches your Stamps up in the background, so
something you did elsewhere shows up without a reload. A new Stamp is one
line under Notifications.

Finished the older four-step welcome? You see only the steps that are
left, and **Hide** puts the list away on every device.

### People you know

While fewer than five of the players you follow played a battle in the
last 7 days, your Timeline opens with **People you know** at the top, every time
you visit, not only the first. Following players who've gone quiet
doesn't put it away. It lists
players you already know in the game, each with why, and **Free** on
anyone following costs nothing:

- clanmates Elixir already records, free to follow ("In your clan,
  already in Elixir"),
- players you played a friendly battle with ("You played a friendly
  battle"), your 2v2 teammates ("Your 2v2 teammate") and clanmates you
  battled in clan chat, from the last 30 days,
- then your other clanmates, the ones who played most recently first ("In
  your clan, played today").

Everyone is ticked. Untick anyone you'd rather not follow, then tap
**Follow these**. One line by the button says what following the ticked
players costs ("8 players · uses 7 of your 50 follows"); it asks once,
with the same line, and follows only the ticked players. Nobody is followed until you tap. Anyone who verified
their player on Elixir sees a new follower in their bell. It
takes at most 10 of your player slots; free ones don't count. **Not now**
puts it away for 30 days; if fewer than five of your follows still play after that, it comes
back. When there is nobody to suggest, it is one line pointing to
[Find](/docs/follow-a-friend#find), where you can search or send your
Follow me link. Nobody is ranked, and names are game names, never a
nickname.

Once you confirm, you can cheer the most recent eligible Timeline item from
the players you just followed. Elixir looks back seven days. **Open Timeline**
is available straight away, even while the item loads or when those players
have no recent activity.

After you confirm, **Your follows are ready** stays beside any remaining
choices. **Open Timeline** starts reading; it follows nobody else.

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
  as a fact, and **Free** on anyone following costs nothing. They come in turn from three
  places: players your own players met in the last seven days (twice or
  more, a friendly battle, or as a 2v2 teammate, those first: "You played
  a friendly battle this week"), players followed by the verified players
  you follow ("Ada follows them"), and your clan's members ("In your
  clan"). Players you already follow or own are never suggested.
  Nobody is ranked by trophies, wins or any rating, and names are game
  names, never a nickname. While **People you know** is at the top of
  your Timeline, this panel steps aside. **Find more people** opens [Find](/docs/follow-a-friend#find).

## Cheers

Open any recorded item on a member Timeline to cheer it. In a group of sessions or Card Mastery updates, expand the group and choose the item. A
cheer is a glyph, with no words beside it, and there are twenty, all of
them happy ones. There is nothing to boo with. You give one cheer per item.

- **Tap the thumbs up** under the item and it is cheered at once with
  Well played. Tap it again to take your cheer back, whichever one it is.
- **The smile beside it** opens six cheers in a row over the item, with
  **More** at the end. Tap one to cheer with it or change yours, or tap
  yours to take it back. On a phone you can also hold your finger on the
  thumbs up to open them.
- **More** shows all twenty in a grid. The last cheer you picked from past
  the six waits just before More next time, when there's room on the
  screen.
- **Not sure what a glyph means?** Hover over it, reach it with the
  keyboard, or hold your finger on it, and its name shows.
- **With a keyboard,** the arrow keys move around the cheers (up and down
  too, in the grid), Home and End jump to the ends, Enter chooses, and
  Escape steps back from the grid to the six, then closes.

Once you have cheered, the button turns violet and shows your cheer's
glyph. If a cheer could not be saved, it goes back to how it was and the
item says so.

An item shows its cheers as glyphs with their numbers: your cheer (or the
thumbs up) on the button with its count, then the next most given kinds
beside it, up to three, with anything more added up as one number, such as
**+4**. Never who. Every member whose feed shows the item sees the same
counts. Your account's own items (a sign-in, a feedback answer) take no
cheers.

The six that open first, then the rest in the order More shows them:

| Cheer | Glyph | Id |
| --- | --- | --- |
| Well played (one tap) | thumbs up | `well_played` |
| On fire | flame | `on_fire` |
| Royal | gem | `royal` |
| Wow | sparkles | `wow` |
| Ha | laughing face | `ha` |
| Grind | flexed arm | `grind` |
| Love it | heart | `love_it` |
| Good game | handshake | `good_game` |
| Congrats | party popper | `congrats` |
| Clutch | lightning bolt | `clutch` |
| High five | open hand | `high_five` |
| Champion | medal | `champion` |
| Nailed it | target | `nailed_it` |
| Climbing | rocket | `climbing` |
| Big brain | brain | `big_brain` |
| Ice cold | snowflake | `ice_cold` |
| Close one | hourglass | `close_one` |
| Lucky | clover | `lucky` |
| Fun to watch | popcorn | `fun_to_watch` |
| Getting better | sprout | `getting_better` |

The id is how an agent reads a kind (`elixir_cheers` counts by id).

The same item keeps its cheers and comments on your Timeline, a [player's page](/docs/player-page), your clan's Timeline, and [the battle it comes from](/docs/battles#cheers). A dated quiet stretch has its own thread. A weekly total like “No battles this week” is a summary.

Verify your player to comment. If a member owns the item, their comment settings apply. On an unclaimed player's update or a clan result, verified players with access to the item can comment. You can report a comment or block its author. Shared links show the item alone.

A cheer stays in Elixir. It goes to no Discord channel or mail, and
`elixir_timeline` does not carry it; an agent cannot cheer. Your own agent
can read the counts on the items about your primary player with the MCP
tool `elixir_cheers`, reading as you: for each
cheered item in the window its id, kind, time, sentence and counts by
kind, never who, and never your own cheer. The bell
counts the cheers on items about your own verified players, never naming
who ([the bell](/docs/your-account#notifications)). You can give
up to 120 cheers an hour.

## Posts

You can write a post of your own: a few words to the people who follow
you and to your clanmates. You need a [verified player](/docs/verified-players)
of your own, and the post goes out as that player.

- **Start one** at the top of your Timeline: tap **Write a post or ask a
  question**, or on a phone tap **Post** beside **Mode** above the feed.
  The writing field takes keyboard focus. **Cancel**, or sending the post,
  returns focus to where you started.
- **Ask a question** marks it a **Question**. People answer it under the
  post. Its answer count includes zero. As its author, you can **Mark
  answered** or **Mark unanswered**. Answered leaves the conversation open
  and does not move the post or announce it as new.
- **Add a deck:** in Clash Royale, tap **Copy deck** on any deck, then
  paste the link into your post. Elixir shows the eight cards with their
  art, the deck's name, its average elixir and a **Copy deck** button. The
  link itself doesn't go in the post.
- **Or add cards:** tap **Add cards** and search by name, up to 8.

A post is words only: up to 500 characters, with no links, photos or
@-names. Every post is checked before it goes up. A check can say no, for
example to bullying, to asking where people live or how old they are, to
trading accounts or to "add me on" another app. It tells you why in one
line and keeps your words so you can change them. You can write 5 posts
a day, one a minute. A post about a battle has its own room: 30 a day,
3 a minute ([Posts about battles](#posts-about-battles)).

Who sees it:

- **People who follow you** or your player, on their Timeline.
- **Your clanmates**, in your clan's Feed.
- **Your account page and your player's page** list your posts too, for
  those same people. Your own posts are on your Profile.
- **Your existing digest** can include new posts and questions from the
  people and accounts you follow, with their deck or cards. Its weekly,
  daily or off setting stays yours. **Read and reply** opens the post in
  Elixir after sign-in.

Anyone who can see a post can cheer it. Notifications tell you how many
cheered your posts, never who. Replies to each post share one notification,
with a count and the latest reply. Questions say **answers**. New replies
are distinct from earlier ones, and the notification opens that post at
the notified reply. **New answer** marks unread answers from other people;
**Older answers** reads back through a long conversation.
Reply words and author names stay inside Elixir; they do not go to email,
push, RSS or agents. Your post and its answers stay yours if your player claim changes.
Nobody you've blocked, or who has blocked
you, sees your posts. You don't see theirs.

**Delete** takes your post away at once. **Report** hides someone else's
post from you right away, and Elixir takes a look.

Treat a post as public. It shows on the Timeline, your clan's Timeline,
your Profile and your player's page. New posts and questions can appear in
the existing digest of people you follow. Anyone who can see a post can
share a link to that one item, readable without an account. Plain posts also
go to your private RSS feed and [your own connected agent](/docs/timeline-tool#plain-posts-and-questions), with the same
follow audience and block/report checks. Comments stay inside Elixir.
Plain posts do not go to Discord or push. A post about a battle goes
further (below).

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
  a link to the session, battle, player or post, and when.
  Never comments, your nicknames for players,
  your email, your account notices, leaders-only facts or cheers.
- **Posts and questions:** from the players and accounts you follow, with
  their deck or card names. A post opens in Elixir after sign-in, where
  access is checked again.
- Blocks, reports, removed posts and hidden posts are checked on each read.
  An edit updates the same entry. Your reader may keep copies it already
  downloaded.
- A feed reader may read it up to 60 times an hour.

## Posts about battles

<a id="highlights"></a>

A post can carry one battle instead of a deck or cards: a battle its
player played, with their own words or none at all. It is written from the
battle's own page by a person whose verified player played it ([Post about
a battle](/docs/battles#post-about-a-battle)), and it is the timeline's one
item about a single battle. One per player per battle. It shows the result,
both decks with the score between them and a link to the battle.

- **Who sees it:** the people who follow the player, on their Timeline,
  and the player's clanmates, in the clan's Timeline. Those readers can cheer
  and answer it. The player's page shows it to every signed-in member.
- **Where else it goes:** your digest email, notifications, your RSS link,
  Timeline to Discord, a clan's Discord channel when its author shares it
  there, and agents all carry it. Its owner's timeline carries its share
  link once they have shared it; nobody else's does.
- **Delete** takes it off every timeline.

Your own agent reads the posts about battles a player wrote, newest first,
with the MCP tool `players_highlights`: each one's sentence, the words
written with it and the battle's link. The tool and the timeline's item
kind (`battle_highlight`) keep the name these had when they were called
highlights. An agent reads them as you, its owner, and never posts or
deletes one.

## Attested facts

Clan tells Elixir what a person did in a clan. Elixir keeps these
**attested facts** apart from the game record, which only collectors
write, and labels each with its source, the person's player, their role,
and when. They are facts with a named source, never Elixir's judgment,
and they appear on the timeline of the readers their type allows.

| Type | Subject | Who may attest it | Who sees it | Detail |
| --- | --- | --- | --- | --- |
| `departure_classified` | clan, about a member | leader, co-leader | the clan | `kind` (`kick` or `leave`), `left_at` |
| `role_change_made` | clan, about a member | leader, co-leader | the clan | `from`, `to` (`member`, `elder`, `coLeader`, `leader`) |
| `award_granted` | clan, about a member | leader, co-leader, elder | the clan | `award` (60 characters), `season_id`, `place` |
| `member_away` | clan, about a member | leader, co-leader, or the member | the clan's leaders and co-leaders | `until` (an instant, or null) |
| `clan_message` | clan | leader, co-leader, elder (a Clan Leader Message: leaders and co-leaders) | the clan | `channel` (`leader_message` or `clan_chat`), `title` (24), `body` (200) |
| `award_standing` | clan, about a member | Clan itself, from the clan's own rules | the clan | `award` (60), `award_id` (40), `season_id`, `place` (1-10), `value`, `unit` (`points`, `donations` or `war_decks`), `as_of`, `previous_player_tag` |
| `drop_game` | player | Elixir Drop's game server | the verified player and followers | game ID, mode, score, answer count, start and finish, and card highlights |
| `personal_record` | player | nobody now; the ones stored stay | whoever has the player on their timeline | `game` (40), `score`, `previous_best` |

"The clan" is anyone whose verified player is in it today, and an agent
whose owner's player is. A fact for the clan's leaders reaches only a
person whose verified player leads it: never an agent and never mail.
A departure's kind is the clan's: the game already tells the whole clan
in clan chat that a member was kicked, and its leaders say why there.

A clan fact is written by a **person**, in Clan. The one exception is
what Clan itself computes from the clan's own rules: `award_standing`,
where a member stands in one of the clan's own awards for a season still
running (Clan writes it each morning). The attester is the person's
**verified** player in that clan, with the role Elixir's roster record
holds for it now; a role the type does not allow is refused.

## Cross-posting to Discord

Your own timeline's sharing is **Timeline to Discord**, on Settings › Connections & agents › Discord. For an agent,
**Manage sharing** on that agent's Timeline opens the same settings in a drawer, and closing it discards unsaved edits. Only the account
owner can save changes, on the website, never MCP.
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
  way, and so does a post about a battle when it is posted or its words change.
  A quiet rung crossed by the clock posts with the next thing the
  record learns about that subject. Nothing from before it was turned on
  is posted. The cross-post's place never moves your read pointer, a
  reader's, or `meta.timeline_pending`.
- **One line per item:** the item's sentence with names made literal,
  then links back to Elixir (the battle, a session's own page, the race
  week, the member, the subject), never previewed. Discord's post time says when; only an item
  over three hours old (a late proof, a quiet rung) adds how long ago
  (`<t:{at_unix}:R>`, from a session's last battle). Nothing pings
  anyone.
- **Edited, never repeated.** When an item grows (a session adds
  battles, or closes, or a post's words change), its message is
  edited in place; a session posted while going is edited to its final
  count within about 45 minutes of its last battle. A message deleted
  in the channel stays deleted, and a line already posted stays when
  its item leaves the timeline (a post deleted on Elixir). A
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
  clan-management routine, a bot for posts about battles, a recruiter watching churn, a
  war-only agent, and a person reading the website. Each reads the sections
  it cares about.
- **It never changes for the mail.** The mail chooses what to say from
  it: the digest tells only the big firsts (a legendary badge among
  them), counts card unlocks and badge levels rather than listing them,
  tells each player once, and draws a clan's own news as a headline and
  its next three facts ([Email](/docs/email#your-digest)). The timeline itself keeps every item, newest
  first.
