---
slug: follow-a-friend
title: "Follow a friend"
description: "Follow any player by tag: recording, the Timeline, Stats, your digest, private nicknames, notification choices and stopping."
section: friends
order: 1
navTitle: "Follow a friend"
icon: heart
lede: "A friend is a player you follow on purpose. Elixir records them like anyone you follow, and includes their play and posts in your digest."
reviewed: "2026-11-27 your friends' friendly battles suggest players; 2026-11-23 boat battles never suggest anyone, and a player met in battle opens on Together; 2026-11-15 everyone with a place is on Near you and the player map; 2026-11-14 Near you and the player map; 2026-11-13 Find opens on Suggested; 2026-11-12 your digest; 2026-10-01 against contract 9.17.1"
callout: ["Open it at Settings › Players & following", "/settings/players", "Open Players & following"]
---

# Follow a friend

Your own players are your primary and your alts. Every other player you
follow is a **friend**, whether you know them already or met them in the game.
Friends share the same player-slot limits and recording rules.

## Adding a friend

On the website:

1. **Settings › Players & following › Follow a player**: enter the tag and press
   **Follow**. Added means recorded; recording starts on the next read.
2. A new follow is a **Friend**. Your first unnamed player is your primary;
   choose **Also you** when adding another player you play as.

Or on **Find** (on the top bar, and a tab on a phone): under **Search**,
**Follow by player tag** takes the tag and adds
the player as a friend in one step. It asks for your own player first if you
have none, and never makes the player your primary. If they verified
their player on Elixir, their bell shows a new follower ([the bell](/docs/your-account#notifications)),
and you also follow their account and their other Verified players
([Linked follows](/docs/verified-players#linked-follows)).

## Clanmates

When you verify a player, Elixir connects you to the people who share that
player’s current clan. Your verified alts count too. Open **Find › Your clan**
to see your clanmates. A Clanmate takes no friend slot.

On a clanmate’s player page, **Friend** adds them to your friends. You can then
star them for your circle. **Unfriend** returns them to Clanmate while you
still share a clan. When Elixir sees either player leave, the Clanmate connection
ends. A friendship you chose carries on across clans.

Blocking an Elixir member hides the connection in both directions. After
unblocking, the current roster decides whether you are clanmates again.

## Find

Find is where you look for people to follow, in sections. It opens on
**Suggested**.

| Section | What it holds |
|---|---|
| Suggested | a list to tap through: players you had a friendly battle with or teamed up with in 2v2 (or met twice) in the last 30 days, players your friends had a friendly battle with in the last 30 days ("Ada played 3 friendly battles with them"; one is enough, and the most played come first), and players followed by the people you follow ("Ada follows them"). Your current clanmates already appear under **Your clan**. Each says why, and **Free** when following costs nothing; what a Follow costs is in its dialog. Boat battles never count: one side attacked the other's clan boat, so nobody played anybody. Tap someone you met in battle to open their page on [Together](/docs/player-page#your-games-together), your games with them. Ten show, then **Show more** (up to 30). With nobody to suggest yet, it says what fills it and offers Search and your Follow me link |
| Near you | people who set a place in your country and region, each as the player they verified, with where ("Plays near you, in Austin") and a Follow button. People in your city come first, then by name. Never ranked, and never closer than the place each picked. You, your own players and people you already follow are left out. Below it, the **player map**: everyone who set a place, a pin at each one. You need [a place](/docs/your-account#your-place) of your own to see who's near you; without one it asks you to set it. There is nothing to join or leave: setting a place puts you on both, and removing it takes you off |
| Your clan | the clans of your verified players, their current members and roles. Tap a name to open their page. **Invite clanmates** gives you words to bring the rest of your clan to Elixir ([Bring your clanmates](/docs/bring-your-clan#bring-your-clanmates)) |
| Search | the search sheet (players Elixir has seen, by name or tag; clans, cards and help), and **Follow by player tag** for anyone else |
| From your battles | the players your own players met in the last 30 days, opponents and 2v2 teammates: players you had a friendly battle with first, then your 2v2 teammates, then the most met. How often, how it went for you ("A friendly battle · Met once · 1 win") and when last ("Last met today, 3:52 pm"), in the Timeline's time format. From the log only, never a rating, and never a boat battle. Players you follow are marked, never hidden. Tap a name to open your games together ([Together](/docs/player-page#your-games-together)) |
| Clan directory | a link to every clan on Elixir |
| Your link | your Follow me link ([A player's page](/docs/player-page#follow-me-links)) |

Your clan, From your battles and Your link need a player of your own.
Each person shows their game name and tag, never a nickname. The Timeline's
**People to follow** and **People you know** draw from the same places
([Beside the feed](/docs/timeline#beside-the-feed), [People you
know](/docs/timeline#people-you-know)).

A first player named `friend` stays that, and the account has no
player of its own until you name one with `relationship: "primary"`.
Through a [connected app](/docs/connections), `elixir_follow_player` takes a `relationship`, so
"follow #TAG as a friend" adds the player as a friend in one call. The
relationship is set when the player is added: for a player already on
your account, change it under Settings › Players & following.

When adding your own player requests its first battles, an admitted
profile already on record is enough: the missing first battle-log read
can be requested without waiting for a new profile. The recorder's
existing first-read limits still apply.

A friend takes one of your player slots unless Elixir already records them: a member of a clan recorded in
full, or a player another account followed first, is free. Find's Follow and
the search sheet say which before you tap ([What a player slot
costs](/docs/recording#what-a-player-slot-costs)).

## What following gives you

While that player's Notifications switch is on, their sessions and moments
appear in your Timeline. Their player page opens Stats, and your connected
app names them under **Friends you follow**.

Your [digest](/docs/email#the-digests) includes friends who played or posted,
up to twelve people with the rest counted. It is weekly on Mondays, or daily
by your choice. Anyone who neither played nor posted is left out.

Some things are only ever about you. A friend's
[firsts](/docs/milestones) are told under the friend in your digest, never
in your own part of it, and a friend cannot be [verified](/docs/verify)
from your account: that belongs to your primary player and your alts.

## Nicknames

Give a friend a nickname on their page (**Nickname**, 1 to 40
characters) or through a connected app with `elixir_nickname`. It is private
to you (apps you connect as yourself see it), and your digest uses it. A nickname
stays when you stop following the player, and an empty one clears it.

## Close friends

Tap the star beside **Following** on a friend's page, or on their row in
Settings › Players & following, to make them a close friend. Close
friends get [your circle this week](/docs/timeline#your-circle-this-week)
on your Timeline and a **Close friends** chip on the feed. The star is private to
you: the friend is never told and nobody else sees it. Unfollowing a
friend, or making them one of your own players, takes the star away. Starring a
Verified player stars their account's other Verified players you follow
too.

## The notifications switch

Each followed player has a **Notifications** switch, on from the start;
a connected app can flip it with `elixir_follow_player` and `action:
"notify_off"` or `"notify_on"`. With it on, the player is a subject of your timeline, which your connected apps
and your Timeline read. With it off, the player leaves your timeline and
your digest too, while recording carries on.

## Stopping

On the player's page, tap **Following**, then **Unfollow**. Or use
**Unfollow** in Settings › Players & following, or `elixir_follow_player` with
`action: "remove"`. The history already recorded is kept, and recording
stops only when nobody else following the player has a reason to keep it.

Unfollowing a Verified player you follow through its account ends the
whole follow: the account and all its Verified players
([Linked follows](/docs/verified-players#linked-follows)).
