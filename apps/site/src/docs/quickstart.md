---
slug: quickstart
title: "Get started with Elixir"
description: "Create your account, track your player and read recorded history in Stats. Clan war history and AI clients are optional, with connection instructions when you want them."
section: start
order: 2
navTitle: "Quickstart"
icon: rocket
lede: "Create your account, track your player, and read recorded history in Stats. Add clan war history or an AI client when you want them."
reviewed: "2026-10-12 against contract 11.11.2"
---

# Get started with Elixir

Start with an account and the player you play as. You can read your recorded
record in [Stats](/home/you/stats) with this account, without connecting an AI client.
Clan war history and AI clients are optional. The steps below tell you what
to do next and what the current record can show.

## 1. Get an account

Anyone can create a free ordinary member account at
[/signin?signup](/signin?signup). Enter your email, then verify
the six-digit code or one-click link (15 minutes, five code attempts).
Signing in and creating an account use the same form. The signup form asks
whether you are 13 or older; Elixir accounts are for people who are. No
invitation or collector is required. Restricted accounts stay restricted.

The signup form also asks for **your player tag**, optionally (plain sign-in
does not). A tag that is not a Clash Royale tag is refused on the form,
before any email is sent; leave the field empty to add your player later.
Nothing happens with the tag until you verify the email: then the new
account tracks it as your primary, and you land on **Home**, whose first
steps show the first read on its way (or **Tag not found**, with the place to
fix it). An account opened without a tag lands on Home too, asking for the
tag. A tag given while signing in to an account that already exists
is ignored; that account keeps its players.

## 2. Track your player

If you gave your tag at signup, this step is done: skip to the first read
below. Otherwise open [Settings › Players & tracking](/settings/players) and add
your Clash Royale player tag. Your first player is your **primary**, which is what every tool
means when you omit `player_tag`. Tracking **is** recording: Elixir reads
your profile and then your battle log straight away, on the live lane, so
both usually land within a minute (a few at busy times), with roughly your
last 30 battles (all the game keeps); history builds from there. Once your
profile shows your clan, Elixir follows that clan for you at activity scope,
which is what puts your clan's week in your Monday email ([Your player's
clan](/docs/recording#your-players-clan)); a player in no clan follows
nothing. Add alts and friends the same way and mark the relationship;
the existing [limits](/docs/roles) still apply. See
[Recording and coverage](/docs/recording) for what gets fetched and how often.

Find your tag in Clash Royale by opening your player profile: it appears below
your name. If the game has no player with the tag you typed, your player's
page says **Tag not found** within seconds, with the fix in the same place:
type the right tag there and Elixir tracks it instead (as your primary, if
the wrong one was), or stop tracking the wrong one. Email verification opens your Elixir account; [player
verification](/docs/verify) separately proves ownership for the features that
require it. An ordinary member account includes activity clan recording, not
recording every member as well. Settings › Players & tracking shows the available slots.

Read your personal season in [Stats](/home/you/stats). Adding a tag opens
your player's record in Settings › Players & tracking. **Player tag saved** means
the tag is on your account, not that a profile has arrived or ownership has
been proved. This page checks saved data every few seconds for the first
minutes after you add a tag, then about once a minute while recording is
pending; **Check again** reads the record without forcing a game fetch. The
first read usually lands within a minute; until both your profile and
your battle log have been read, Stats says it is on its way rather than
showing an empty season.

**Home** lists what is done and what is next: the tag
saved, a profile, battles on record, then **Player verified (needed to act
in Clan)**, which links to [Verify](/settings/players/verify): one battle
with a deck Elixir names proves the player is yours, and Clan needs
it before you can act in your game role. Clan war history and AI clients
follow as optional lines.

**View recorded profile** opens the saved profile and its dated trophies and
lifetime counters. **Browse recorded battles** opens recorded battles newest
first, including retained history older than 30 days; **Older battles** reads
the next page. A profile alone does not establish recorded battle history.
Recorded clan history links to a specific saved war week, independently of
private Clan actions. AI setup is optional and follows these browser reads.

Read attempts and saved facts are separate: a recent failed fetch does not
make a tag invalid or remove retained information. An incomplete measured
profile interval names its bounds and recorded and expected counts; other time
remains unknown, even after a successful read. Error receipts have bounded
retention, so missing error metadata does not mean a read succeeded.
Paused or stopped recording still links to the information already saved.
Check Settings › Players & tracking for status rather than treating an empty window as proof that
you did not play.

If you want clan war history, follow [Bring your clan](/docs/bring-your-clan).
Private Clan actions still require verified membership and the appropriate game
role. Running a collector is optional and open to anyone signed in (raising
your hand approves it); it does not multiply the shared fetch budget.

## 3. Ask something

**Optional: ask through an AI client.** [Connect a client](/docs/connect-a-client) first if you want one.

**Home** shows what is recorded for your primary so far,
links to your next step in Settings or Stats, and offers an optional first
question matched to that record. A profile is enough to start. Active client
connections and successful data reads in the last seven days are reported
separately: authorizing a connection alone does not confirm a data read.

**Settings › Connections & agents** offers more starter questions matched to it under
**Try asking…**: a review of one reading when only a profile exists, a seven-day
review once battles are in (30 days if the last week is empty), a deck
comparison when two decks appear, a week-over-week comparison when both
windows have battles. Copy one into your client. You never need to tell
the client your tag; if it starts by listing your players, that is a bug
worth reporting. The agent can also read this manual itself: `elixir_docs`
serves these pages over the connection, and the
[examples](/examples/play) are offered as prompts, so "how do I scout a
bracket?" is a question it can answer before it calls anything.

Connections also counts each connection's calls over the last seven days,
so you can tell an authorized connection from a working one. **Settings › Usage and limits › Requests** lists every call with its `request_id`.

## What next

- [Users, agents and integrations](/docs/connections): a bot for a whole
  clan rather than a connection for yourself.
- [Tools](/docs/tools): everything the connection can call.
- [Reading a response](/docs/responses): the `meta` envelope every answer
  carries.
- [Limits](/docs/limits): account quotas and how calls are counted.

## If something goes wrong

Quote the `request_id` from the response's `meta` when you report an answer
that looks wrong. Your own call history, with those ids, is under **Settings › Usage and limits › Requests**; refused credentials appear on **Settings › Connections & agents**.
