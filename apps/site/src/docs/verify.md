---
slug: verify
title: "Verify: proving a player is yours"
description: "How Elixir proves that an account controls a Clash Royale player: play one battle with a deck we name, what a verified claim proves and does not, why the battle log and not the profile is the proof, and what is read."
section: start
order: 4
navTitle: "Prove a player is yours"
icon: shield-check
lede: "Play one battle with a deck we name, and the claim on your player becomes a fact rather than a promise."
console: ["Verify a player you have added", "/console/account/verify", "Console ▸ Verify"]
reviewed: "2026-10-08 against contract 11.2.4"
---

# Verify: proving a player is yours

Adding a player to your account is a claim: "this player is me." For
most of what Elixir does a claim is taken on trust, and that is fine.
Acting for a clan is different: what a leader can do in Elixir Clan
should open for the account that controls the leader's tag and nobody
else. Verify turns a claim into a proven fact.

## The challenge

Only you can decide which eight cards your player takes into a battle,
and the game's battle log records exactly that for every match. That is
the challenge.

1. Pick the player, under **Console ▸ Verify**. The page lists your
   primary player and your alts, the claims that are yours to prove; a
   friend or a player you merely watch is theirs. Players are added under
   Tracking, as always; Verify only proves them.
2. Elixir names eight cards and shows them the way the game lays a deck
   out: two rows of four. The eight are **your own deck**: the one you
   played most in your last ten recorded Trophy Road battles, with two
   cards swapped for cards you own of similar elixir cost. The two swaps
   are marked, so the brief reads as "your deck, two changes" rather than
   eight strangers, and the deck is playable because you already play it.
   A deck you have played in the last month, in any mode, is never the
   target; the swaps are redrawn until the result is new. Only a player
   with no recorded Trophy Road battles gets eight cards drawn at random
   from the recorded collection. Tower troops are never among them.
3. Make the two changes in a slot and play one battle with it, in any
   mode, win or lose. The deck comes from Trophy Road because a mode that
   hands you a deck (an event, a draft) says nothing about the deck you
   play; where you play the proof is up to you.
4. Beside the brief, the page shows your latest battle since you started,
   with its deck marked card by card against the target, and its result.
5. When a battle's deck is exactly the eight cards, the claim is marked
   verified and the page says so, with the battle that proved it. Switch your deck back; the proof is already recorded.

A challenge stays open for an hour. If it runs out before a matching
battle, starting again hands you the same eight cards for a day, so a
deck you already built is not wasted. Refreshing the page resumes the
open challenge.

## What is matched

The set of eight card ids in the deck you played, compared with the
eight the challenge named. Order does not matter, card levels do not
matter, and whether a card is in its evolution or hero form does not
matter, and neither does the mode. A battle played before the
challenge was issued never counts, even if its deck happens to match;
the proof is a battle played after the brief.

## Why a battle, not a deck slot

Selecting a deck in a slot is not enough, because the profile's
`currentDeck` is a cached snapshot that the game refreshes on its own
schedule: the API can keep reporting the old deck for more than an hour
after a slot is selected. The battle log is fresh: a finished battle is
readable within about a minute, and it names the deck each side played.
So the proof is a battle.

## What it proves, and does not

A verified claim proves that whoever holds this account could choose the
deck that player took into a battle at that time. It does not prove
anything about other players on the account, it does not stop a second
account from adding the same player unverified, and it is not a
Supercell feature: nothing here uses their account system.

A tag has one verified owner. If another account has already verified a
player you try to verify, the page says so; if that player is yours, sign
in to the account that verified it, or tell us through the feedback form.

## Privacy and cost

Verify reads only your public battle log and profile, the same documents
any Clash Royale app can fetch with your tag. The reads it asks for are
not charged to your daily live-fetch allowance. Starts are limited to a
few an hour, for each account and for each player, so the wizard cannot
be used to make the collectors read somebody's log on a loop. A player's log is read for
verification at most 120 times a day, across every challenge for that
tag, whoever opened it: about one and a half hours of a watched
challenge. Past that the challenge stays open, the page says so, and the
check waits for the player's regular recording until the reads come
back within a day.

Verification is recorded on the claim itself (`status`, method and
time), with the proving battle on the challenge, so anything that later
needs "is this claim proven" can read it without a second lookup.
`elixir_my_players` carries it as `claim_status` (`verified` or
`unverified`) beside each player you track. No data tool changes its
answers on it; the record is the same for everyone.

[Elixir Clan](/clan) checks it on every request, inside Elixir. Any
player of your own (your primary or an alt) in a clan lets you open that
clan as a member and read it. Acting in the clan, the clan map, and the
tools your in-game role brings (Elder, Co-leader or Leader) wait until
that player is verified, and Clan names the player whose verification
would bring more.

Verification also decides what a clan says to its own members: an
[attested fact](/docs/integrations#attested-facts) a clan's leaders
recorded reaches the timeline of readers whose **verified** player is in
that clan (and a member's away only those whose verified player leads
it), because it is the clan's own word, not the game's; and Clan's mail
about a clan goes only to the account that verified the player it is
for.
