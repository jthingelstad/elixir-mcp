# Elixir

**Elixir is the missing social layer of Clash Royale.** Said another way,
Elixir lets you connect with your friends and play together more in Clash
Royale.

Clash Royale is a great game and has been around for more than a decade,
but you mostly play battles by yourself. You can add someone as a friend
and battle them, but the game doesn't show you their battles or let you
celebrate their milestones. Elixir is how you keep up with your friends,
learn what they're doing, and celebrate their accomplishments as well as
your own. You do the same with your clan, which is just another group of
friends.

Elixir is to Clash Royale what Strava is to your workouts: the game does
the playing, collectors record it, and Elixir is the place where people
see it, follow each other and celebrate.

This page is the root. The [product briefs](docs/product/README.md) and
[DECISIONS](docs/DECISIONS.md) follow from it, and where they disagree
with it, this page wins until they are rewritten. It comes from Jamie's
product vision interview of 2026-11-11.

## Who it is for

Normal players, not elite pros. Each of these has a use for it:

- **A casual player** follows what their friends are doing and connects
  with clanmates, even with nobody in real life who plays.
- **A parent** follows their kids' play, or plays too and uses Elixir to
  connect with them.
- **A clan leader** runs the clan on a policy: Elixir knows what the clan
  is and what "good" looks like for it.
- **A player looking for a clan** finds one whose policy matches how they
  want to play, instead of the in-game clan search, which is "absolutely
  atrocious".

The moment that sells it today is the weekly email: you see that your
nephew levelled up and hit milestones, and you text him "wow, great job
this week".

## What you see

A timeline of the players you follow, newest first, with your own play in
it. The unit is the **gaming session**, not the single battle: "Tyler
just did 12 battles, here are the cards he played with." Around the
sessions are the moments: a deck switch, a card earned for the first
time, a new arena, a new rank in ranked play, a special badge such as a
legendary one.

You react to items with a fixed set of emoji, and share them. A player
can open a session, pick one game and **highlight** it with a short
comment of their own; it shows on their profile and timeline as a battle
card (both decks, Elixir's numbers, their words), so players curate their
own battles. Replays stay in the game.

What brings you back: curiosity about the feed, the way you check a
reader or a social app; a digest email; and Discord, where a clan's
server gets a stream of events that link back to Elixir.

## Everyone signs in

The Clash Royale API is open, so nearly nothing in the game is private.
Elixir is for its members: everyone signs in, to read as well as to
follow, react, highlight and run a clan. A post its owner shares, and its
link preview, opens without an account. (Changed 2026-11-11 from "anyone
can read a player's timeline without signing in".)

| What | Who sees it |
| --- | --- |
| Everything from the game | Every member |
| Who you follow and who follows you | Every member |
| Verification (your Clash Royale player, your Discord) | Every member, as badges |
| Nicknames you give players | Only you |
| Your Discord username and profile | Nobody; it shows only as a "verified in Discord" badge, and Elixir never helps anyone find a person in Discord |

Every player is an RSS feed, read through a private token link. A "Follow me in
Elixir" link carries one or more player tags, for "follow me and my alts"
or "follow this group", from any page on the web.

Once a player has verified their Clash Royale account by playing a battle
and connected Discord, Elixir holds a verified chain from Discord user to
Elixir account to Clash Royale player.

## Finding people and clans

- **Your clan:** one click to see everyone in it and follow them, or
  "follow my clan", which keeps following whoever is in it as members
  come and go.
- **Search:** players who exist in Elixir, meaning everyone someone has
  followed.
- **Your battle log:** follow a notable opponent from it.
- **Location:** opt-in, never finer than a city or a zip code. Players on
  a map, to find players in your region, and the clan map.
- **The clan directory:** search on what only Elixir has, the dimensions
  of a clan's policy and its description. Setting a policy is how a clan
  opts in to being found.

Signing up asks the person to attest they are 13 or older.

## Clans

Clan is one piece of the social fabric, in one view. A leader's Actions
become notifications for leaders and items on the timeline; what is not
timeline-shaped, such as award standings, has a clan section. A leader
gets what the game cannot give them: a policy that is actually run,
award standings and the Free Pass they would otherwise keep by hand, real
activity in place of the idle badge, Discord by webhook with no bot to
run, and recruits who match how the clan wants to play.

## Agents

Connecting your own AI agent to Elixir over MCP stays core.

## Never

The list is short:

- **Elite or pro tracking.** Top players are welcome as ordinary users,
  but nothing is built to track the top 100 or championship play.
- **A deck builder.** That is a project of its own.

## A year from now

A place where you connect with clanmates, people you know in real life
and people you know in the game, celebrate together and have fun
together. A thousand people would be amazing. Elixir earns no revenue:
Jamie pays for it as a way of giving back to the community, so it has to
stay affordable. Ordinary member signup is public and free.

The test: players who use Elixir are having more fun playing Clash
Royale because they play it with Elixir.

## Open

- Defaults for young players beyond the 13+ attestation (the player map,
  shared posts), worth a legal view.
- The cost of each followed player, and the limits that keep about 1,000
  people affordable.
- The digest's cadence: weekly, daily, or the person's choice.
- The fixed set of reactions.
- Whether and when comments come, and the moderation they would need. A
  player's own words on their highlight are not comments.
- The interview named nicknames and Discord identity as the private
  data. A person's email address and the account's own machinery (sign-in,
  agent keys, feedback, mail records) are taken to stay private too.
