---
slug: player-page
title: "A player's page"
description: "The one page every player name opens for a signed-in member: the player's timeline, posts and moments, and for a player an account verified, that account's follows, followers and badges. Following from the page, following several players at once, and Follow me links."
section: friends
order: 7
navTitle: "A player's page"
icon: user-round
lede: "Every player's name on Elixir opens one page: what the player has done lately, and who follows whom. Stats and Clan are a link away from it."
reviewed: "2026-11-12 against contract 11.21.0"
---

# A player's page

A player's name opens their page, wherever the name is: the Timeline, Find, the
search sheet, a battle, Stats and the email. The address is
`/home/player/<tag>`, the tag without its `#`. You need to be signed in, as
for every read of Elixir.

The page leads with the player's game name, tag, clan and trophies, beside
their picture: the card their account chose as its
[profile image](/docs/your-account#your-profile-image) once the player is
verified, else their initials. The same picture is beside the player in
their follows and followers. Under it:

| Tab | What it holds |
|---|---|
| Timeline | the player's **Posts** first: their posts about battles, each with its battle and their own words, and any other posts you may see; then what the record holds for the player in the last seven days, newest first |
| Moments | the timeline's moments: a new arena, a promotion in Ranked, a badge, a clan joined or left. A moment Elixir saw happen in a battle, like a promotion won on a 3-0, has **Open the battle** |
| Follows | who the player's account follows, and who follows it |
| Record | the recorded profile: the last 30 days in battles, wins, losses, trophies and the deck played most, and the profile's trophies, best and lifetime counts as of its last capture |
| Together | on a followed friend's page, your verified player's recorded games with them: **Teamed up** and **Played against**, one mode at a time |

Every item on the Timeline and Moments tabs looks just as it does on your
Timeline: a moment shows its card's or its badge's art, a deck change shows
the new deck, and a short session or a small moment is one line. A session
is the same card as on your Timeline: its headline,
its figures and bar chart, and the deck played most. Tap it for the
session's own page ([Your timeline](/docs/timeline)), which you can share
with anyone ([Share a session](/docs/timeline#share-a-session)). Profile's Timeline tab is the same.

You can cheer a recorded item on the Timeline or Moments tab, including an older update from a player you haven't followed. A cheer or comment stays with that item wherever you see it. [Cheers and comments](/docs/timeline#cheers)

**Profile** (`/home/you`) is your own [account page](/docs/verified-players#account-pages),
with **Your stats**: [your season, read back](/docs/ladder). Each of your
players opens its own page from there. Your players' pages offer **Your stats**, and a clanmate's page
**Open in Clan** when your clan runs Clan.

## Your games together

Open **Together** on a player you follow. It reads the last 30 days for
your verified player and that friend. If you have more than one verified
player, choose **Your player**. Choose **Mode** to keep different games
apart.

- **Teamed up** means both players were on the same side of the recorded
  battle.
- **Played against** means they were on opposite sides.

Each row opens that battle. **Older team battles** and **Older opponent
battles** read further back in the same mode and window. Boat defenses
aren't live games between the two players, so they aren't here.

Only actual shared battle records count. Elixir does not infer a meeting
from being clanmates or playing around the same time. If none are on
record, the page says so. A battle Elixir did not read is not here.
The same block rules apply, and this view lists no games your friend
played with anyone else.

## Check for new battles

Under the player's name, **Check for new battles** asks for a fresh read of
that player's battle log. While it looks the button says "Checking…".
When the read lands, the page shows the new battles without a reload and
the button says "Updated just now".

On your own player it does what tapping the freshness chip does. On
anyone else's page it is one read of their battles, and it does not start
following or recording them. A log read in the last two minutes counts as
fresh and is not read again. You can ask about one player once every two
minutes, and about other players' battles 10 times an hour, from your
daily [live fetches](/docs/limits). When a limit says wait, the button
says "Try again in 2 min" (or however long it is), and nothing else
changes.

## Follows, followers and badges

What a page shows about an account is what [Privacy](/docs/privacy) makes
public: who it follows, who follows it, and its verification badges. A page
shows them for a player an account has [verified](/docs/verify), and for no
other player, because follows belong to an account and an unverified player
has no account to speak for.

- **Following** lists the players the account follows.
- **Followers** names each account that follows the player by the player that
  account verified, game name and tag, with the gold check. An account that
  added a player but hasn't verified it shows as that player, marked **Not
  verified**, with no gold check: it's who they say they are, not proof. An
  account with no player at all shows only as an Elixir account, and nothing
  more about it.
- **Badges** say that the account verified this player, and that it linked a
  Discord account, never which one.

A page never shows a nickname, yours included, a Discord username or an email
address.

Your own agent reads the same section with the MCP tool `players_follows`, reading as you: `badges`,
`follows` and `followers`, null when no account has verified the player.
Each follower carries `verified`, false for a player the follower claims and
hasn't verified, and `no_player` counts the followers with no player at all.
It never follows anyone on the
page's behalf; following stays your ask (`elixir_follow_player`).

## Following from the page

**Follow** asks first. The question names the player, says their bell shows
a new follower if they verified their player on Elixir,
and says what it costs: free when Elixir already records them, or one of your
player slots ([What a player slot costs](/docs/recording#what-a-player-slot-costs)).
Nothing is followed until you confirm. Once you follow a player, the button
reads **Following**; tap it to **Unfollow**, asked first too.

A shared clan shows **Clanmate** and the clan’s name. Choose **Friend** to
add them as a friend. **Unfriend** returns them to Clanmate while you share
a clan. [How Clanmates work](/docs/follow-a-friend#clanmates).

A player in another clan can offer **Follow everyone** in that clan, at the foot
of the **Follows** tab: one question
for the clan's current members (at most 50), saying how many are free and how
many take a slot, against the slots you have left. Past your limit it is
refused whole, and says why; nobody is followed in part. One that needs no
slot always goes ahead. Your own players are left out, and the question says
so. In your own clan, [Clan › Members](/docs/bring-your-clan) opens each clanmate’s page.

## Follow me links

Your own page has **Copy my Follow me link**:
`/home/follow/<tag>`. A link can name several players, comma-separated
(`/home/follow/<tag>,<tag>`), and it names only them: no id for who sent it,
and nothing records who copied it.

Opened signed out, the link explains Elixir and offers **Join Elixir** and
**Sign in**; either brings the reader back to the link. Signed in, it lists the
players, each with its Follow and what it costs, and **Follow all** when there
are several, asked once with the same pricing and refusal as following a clan.

## Connections through play

**This week in play** on the player's Timeline connects recent observations. A Mastery milestone can name how many recent recorded Trophy Road or Ranked battles used the card. A deck change can name the card or form that changed. A reported season best in Merge Tactics, 2v2 League or Seasonal Trophy Road can show the earlier and later values in the same season.

On **Find › Your clan**, Elixir compares up to 30 recorded Trophy Road and Ranked battles per player from the last 14 days. A deck comparison uses the same mode and requires both players to have brought their decks at least twice. A shared card must occur in at least three battles and half the sampled battles in that mode for each player. An open deck post’s **I tried this deck** checks your verified players for a matching eight-card battle after the post, up to 30 days back. You choose whether to publish.
