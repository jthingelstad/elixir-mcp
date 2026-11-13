# Accounts and privacy

*Rewritten 2026-11-13 to the social layer, from the brief Jamie ratified
on 2026-10-12, under [`VISION.md`](../../VISION.md) and the rulings in
[DECISIONS](../DECISIONS.md) of 2026-11-11 and 2026-11-12. It waits on
Jamie's read; where it and DECISIONS disagree, DECISIONS wins.*

## What it is for

An account is how a person joins Elixir: who they are in the game, who
they follow, where their mail goes, and the agents and apps that act as
them. Elixir is for its members, so everyone signs in, to read as well
as to follow, cheer, highlight and run a clan. One account is one
person; everything in Elixir (Home, Stats, Clan, mail, a connected
agent) acts as that same person. [Jamie, 2026-09-03, 2026-11-11]

## Who it serves

- **Normal players, and the people around them.** A casual player
  following friends and clanmates, a parent following their kids, a
  clan leader, a player looking for a clan. Signup is public and free:
  verify an email, attest you are 13 or older, and the account opens.
  No privileged tier, collector token or extra capacity comes with it; a
  denied or disabled account never reopens through signup. Elixir takes
  no money and earns no revenue. [Jamie, 2026-10-06, 2026-11-11]
- **The person's agents and apps.** Three kinds of principal: users,
  agents and integrations. An agent is the person's own, capped at its
  owner's tier, following in the person's pooled slots, never deleted
  (suspended or revoked). [Jamie, 2026-09-08, 2026-09-23, 2026-10-10]
- **The family's apps.** Sign in with Elixir carries the person to Drop
  and to Elixir Clan; the address goes only to a family app. [Jamie,
  2026-09-25]

## Who sees what

The Clash Royale API is open, so nearly nothing in the game is private.
[Jamie, 2026-11-11, `VISION.md`]

| What | Who sees it |
| --- | --- |
| Everything from the game, tags included | Every member |
| Who you follow and who follows you | Every member |
| Verification (your Clash Royale player, your Discord) | Every member, as badges |
| A highlight you post | Your player's followers on the timeline; anyone with its link once you share it |
| Where you play, if you share it (a city at most) | Your clan's verified members, on its map, while its leaders keep the map on |
| Nicknames you give players | Only you |
| Your Discord username and profile | Nobody; it shows only as a "verified in Discord" badge |
| Your email address and the account's machinery (sign-in, agent keys, feedback, mail records, usage) | Only you, and the address to a family app |

[Jamie, 2026-09-08, 2026-11-11, "What is public about an account",
"Location is opt-in and a city at most"; engineering, 2026-11-11: email
and the machinery stay private] Settings › What members see says this as
built, linking each choice to the page that owns it.

## Principles that decide the details

1. **Email is the identity; Discord is a way in.** No password; a code
   or link signs in. A Discord sign-in reaches the same email-identified
   account, never a second identity, and a person may link one Discord
   account so that a clan's agent knows who is asking. Elixir never helps
   anyone find a person in Discord. [Jamie, 2026-10-12, 2026-10-24,
   2026-11-11]
2. **A claim is trust; Verify is proof.** Adding a player says "this is
   me" and is taken on trust for what a person does for themselves.
   Highlighting a battle, acting for a clan and being named as a
   player's account need proof: one battle with a deck Elixir names. A
   verified tag has one owner, and verifying ends other accounts' claims
   to be that player. [Jamie, 2026-09-12, 2026-10-12]
3. **Following costs a slot only when you cause recording.** 50 player
   slots at every tier; a follow takes one only when Elixir records the
   player because of you, so "a clan all following each other is flat
   cost". Your primary player's clan is followed for you, never past a
   slot or in place of a choice you made. [Jamie, 2026-10-08,
   2026-11-11]
4. **Roles never gate visibility, and a tier is earned in the game.**
   Every member reads the whole record; tiers differ only in slots and
   call volume. **Member** is signup; **Leader** comes with being a
   verified leader or co-leader of a clan you follow; **Family** comes
   with running a collector. **Partner**, full access to Elixir's API
   surface, stays granted by Jamie and may go if it confuses the page.
   [Jamie, 2026-09-05, 2026-10-12, 2026-11-11]
5. **Measurement is aggregate.** Never a per-recipient open or click,
   never a referral id; a Follow me link carries player tags and nothing
   else. [Jamie, 2026-09-19, 2026-10-08, 2026-11-11]
6. **The person owns the switches.** Settings holds them: players and
   follows, every mail kind and the digest's cadence, time zone,
   connections and their grants, agents, the RSS link, Discord, feedback
   and its answers. Every mail has its own off switch and a stop is never
   undone. The app tells time in the account's zone, named. [Jamie,
   2026-09-23, 2026-10-08, 2026-11-11]
7. **Feedback is one system.** From anywhere in Elixir, into one record,
   answered by the maintainer, and told back once. [Jamie, 2026-10-08,
   2026-10-11]
8. **The policy pages restate the service in plain terms**, change only
   with Jamie's word, and the code is the policy. [Jamie, 2026-09-28]

## What it never does

No ads, brokers, selling or sharing, engagement scoring, automation on
read state, or commercial targeting from game data. Analytics is
client-side Tinylytics only; the servers send it nothing. No approval
queue for signup. [Jamie, 2026-09-19, 2026-09-24, 2026-11-12]

## When a person leaves

Removal is by request. The account and everything that is the
account's goes, highlights included; the players' game history stays,
as any unfollowed subject's does. [Jamie, 2026-10-12; see the record]

## Open

- **Whether Partner stays.** Default in force: it stays, granted by
  Jamie; the Roles page explains the three earned tiers first.
- **Defaults for young players** beyond the 13+ attestation (the player
  map, shared posts), worth a legal view. Default in force: no player
  map or Near you; a clan map only. [`VISION.md`, Open]
- **Whose follows and followers are shown.** The player page shows them
  only for a player an account verified, and names a follower only by
  their own verified player. [engineering, 2026-11-12]
