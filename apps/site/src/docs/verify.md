---
slug: verify
title: "Verify: proving a player is yours"
description: "How Elixir proves that an account controls a Clash Royale player: the deck-slot challenge, what a verified claim proves and does not, why a freshly set deck can take a minute to appear, and what is read from your profile."
section: using
order: 17
navTitle: "Verify"
icon: shield-check
lede: "Set a deck we name, and the claim on your player becomes a fact rather than a promise."
console: ["Verify a player you have added", "/account/verify", "Console ▸ Verify"]
---

# Verify: proving a player is yours

Adding a player to your account is a claim: "this player is me." Until
now that claim was taken on trust, and for most of what Elixir does that
is fine. Products that act for a clan are different: a leader-only view
should open for the account that controls the leader's tag and nobody
else. Verify turns a claim into a proven fact.

## The challenge

The Clash Royale API exposes exactly one field a player can set from
inside the game and that the API shows to everyone: the active battle
deck. That is the challenge.

1. Pick the player, under **Console ▸ Verify**. A tag you have not added
   yet is added first (unverified, and recorded from then on).
2. Elixir names eight cards, drawn at random from the cards your recorded
   collection says you own, and shows them the way the game lays a deck
   out: two rows of four. Tower troops are never among them.
3. Put those eight cards in an empty deck slot in the game and select it.
4. Beside the brief, the page shows the deck Elixir last saw for your
   player, refreshed about every fifteen seconds. Each card that matches
   lights up as it appears.
5. When all eight are in place the claim is marked verified and the page
   says so. Switch your deck back; the proof is already recorded.

A challenge stays open for twenty minutes. If it runs out, start again
and you get a fresh deck. Refreshing the page resumes the open
challenge, and starting a second one while the first is open returns the
same eight cards.

## What is matched

The set of eight card ids in your active deck, compared with the eight
the challenge named. Order does not matter, card levels do not matter,
and whether a card is in its evolution or hero form does not matter. A
deck seen before the challenge was issued never counts, even if it
happens to match; the proof is a deck observed after the brief.

## Why it can take a minute

The game's API caches player profiles for about a minute. When you
select the deck slot, the API keeps showing the previous deck until that
cache turns over, and Elixir then has to fetch the profile through a
collector. Usually the new deck shows within a minute; sometimes it takes
a few. The page checks every fifteen seconds while it is open, and the
server asks a collector for a fresh read at most once every forty-five
seconds. You do not need to do anything but wait; keep the page open.

## What it proves, and does not

A verified claim proves that whoever holds this account could change the
deck on that player at that time. It does not prove anything about other
players on the account, it does not stop a second account from adding the
same player unverified, and it is not a Supercell feature: nothing here
uses their account system.

A tag has one verified owner. If another account has already verified a
player you try to verify, the page says so; if that player is yours,
contact us through the feedback form and we will look.

## Privacy and cost

Verify reads only your public player profile, the same document any
Clash Royale app can fetch with your tag. The reads it asks for are not
charged to your daily live-fetch allowance, and a start is limited to a
few an hour so the wizard cannot be used to make the collectors read
somebody else's profile on a loop.

Verification is recorded on the claim itself (`status`, method and
time), so anything that later needs "is this claim proven" can read it
without a second lookup. No tool changes its answers yet; consumers
come later.
