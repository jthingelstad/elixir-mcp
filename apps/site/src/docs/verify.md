---
slug: verify
title: "Verify: proving a player is yours"
description: "How Elixir proves that an account controls a Clash Royale player: play one battle with a deck we name, what a verified claim proves and does not, why the battle log and not the profile is the proof, and what is read."
section: using
order: 17
navTitle: "Verify"
icon: shield-check
lede: "Play one battle with a deck we name, and the claim on your player becomes a fact rather than a promise."
console: ["Verify a player you have added", "/account/verify", "Console ▸ Verify"]
---

# Verify: proving a player is yours

Adding a player to your account is a claim: "this player is me." Until
now that claim was taken on trust, and for most of what Elixir does that
is fine. Products that act for a clan are different: a leader-only view
should open for the account that controls the leader's tag and nobody
else. Verify turns a claim into a proven fact.

## The challenge

Only you can decide which eight cards your player takes into a battle,
and the game's battle log records exactly that for every match. That is
the challenge.

1. Pick the player, under **Console ▸ Verify**. Only your primary player
   or an alt can be verified; a friend or a player you merely watch is
   theirs to prove. A tag you have not added yet is added first, as an
   alt, and recorded from then on.
2. Elixir names eight cards, drawn at random from the cards your recorded
   collection says you own, and shows them the way the game lays a deck
   out: two rows of four. Tower troops are never among them.
3. Build that deck in a slot and play one battle with it. Any 1v1 counts,
   win or lose; Trophy Road or Path of Legends is quickest.
4. Beside the brief, the page shows your latest battle since you started,
   with its deck marked card by card against the target, and its result.
5. When a battle's deck is exactly the eight cards, the claim is marked
   verified and the page says so, with the battle that proved it. Switch
   your deck back; the proof is already recorded.

A challenge stays open for an hour. If it runs out before a matching
battle, starting again hands you the same eight cards for a day, so a
deck you already built is not wasted. Refreshing the page resumes the
open challenge.

## What is matched

The set of eight card ids in the deck you played, compared with the
eight the challenge named. Order does not matter, card levels do not
matter, and whether a card is in its evolution or hero form does not
matter. A battle played before the challenge was issued never counts,
even if its deck happens to match; the proof is a battle played after
the brief.

## Why a battle, not a deck slot

The first version of Verify asked you to select the deck in a slot and
waited for the profile's `currentDeck` to show it. It never did: measured
on the owner's own account on 2026-09-12, the API kept reporting the old
deck for more than an hour after the slot was selected, with the game
closed and no battle played. The profile is a cached snapshot that the
game refreshes on its own schedule. The battle log is not: a finished
battle is readable within about a minute, and it names the deck each
side played. So the proof moved to where the fact is fresh.

## What it proves, and does not

A verified claim proves that whoever holds this account could choose the
deck that player took into a battle at that time. It does not prove
anything about other players on the account, it does not stop a second
account from adding the same player unverified, and it is not a
Supercell feature: nothing here uses their account system.

A tag has one verified owner. If another account has already verified a
player you try to verify, the page says so; if that player is yours,
contact us through the feedback form and we will look.

## Privacy and cost

Verify reads only your public battle log and profile, the same documents
any Clash Royale app can fetch with your tag. The reads it asks for are
not charged to your daily live-fetch allowance, and a start is limited
to a few an hour so the wizard cannot be used to make the collectors
read somebody else's log on a loop.

Verification is recorded on the claim itself (`status`, method and
time), with the proving battle on the challenge, so anything that later
needs "is this claim proven" can read it without a second lookup. No tool
changes its answers yet; consumers come later.
