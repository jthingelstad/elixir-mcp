# Home

*Rewritten from the Console's brief at step 3 of the redesign, under the
rulings in [Structure](structure.md). Home lives at `/home` and, since step 3b,
is where signing in lands and where `/console` goes.*

*Under [`VISION.md`](../../VISION.md) of 2026-11-11, Elixir is the missing
social layer of Clash Royale. Where this brief disagrees with the vision or
[DECISIONS](../DECISIONS.md), they win; the brief is rewritten after the
Design session (#752).*

## What it is for

Home is where a person sees their own day: what needs them, how their week is
going, what their clan is doing, and what happened to the people they follow.
Elixir is a recorder, so Home says facts and leaves the judging to the person.

## Who it serves

The signed-in person. An agent has no Home.

## One feed [Jamie, 2026-11-12]

Asked "Slice 7, Home: one feed with chips Everyone, Friends, Clan and You, session sparklines, a new top bar and phone tabs (Home, Find, Clan, You, bell) replacing Home's three tabs, and reactions. Which reactions?", Jamie answered "Yes, six cheers (Recommended)". The three
tabs Today, Timeline and Friends are replaced:

- **Home** (`/home`): one feed of the last seven days, newest first, in days,
  with the chips Everyone, Friends, Clan and You, and State (All, New) as
  before. A sitting carries its sparkline. Your week, the clan panel and Setup
  details sit beside it. A new account gets its steps instead until the first
  read lands; they are worked out from the record each time and nothing is
  stored.
- **Find** (`/home/find`): search, Follow a friend, the clan directory and your
  follow link. Friends' follow form moved here.
- **You** (`/home/you`): your players' pages, their stats in Ladder, Settings
  and signing out.
- **The bell**, on every page: Needs you, moved out of Home.
- **Cheers** (the same ruling's six): one per person per item, on an item
  about someone or a clan the person follows, shown as counts and never as
  who; a second tap on yours takes it back. Not on the account's own items,
  and nowhere but Home's feed: no bell, mail, Discord, agent or MCP.
  [engineering, 2026-11-12]
- **Your RSS link** (DECISIONS "Your timeline is an RSS feed"): one private
  link per person to their own feed, made, reset or turned off in Settings ›
  Connections & agents, shown once because Elixir keeps only its
  fingerprint. [engineering, 2026-11-12]

`/home/timeline` opens Home and `/home/friends` opens Find. Friends' week
cards left Home; Wednesday's digest tells that week. [engineering,
2026-11-12]

## Principles that decide the details

1. **Needs you is Clan's list, not a second one.** It is the bell's sheet
   since slice 7. The top two open Actions in
   Clan's own order and "and N more waiting in Clan" (Run's Waiting since slice 8). Opening Home evaluates,
   raises and numbers nothing, so the list can lag Clan by up to the next
   morning's run or Clan visit. Other kinds appear only with a real source.
   [engineering, 2026-11-05]
2. **Each panel for itself.** The page paints from one fast read, and each
   slow panel then reads alone with its own loading state. A visit spends one
   charge on the person's hourly bucket, the head's. A panel that fails says so
   and the rest render. [engineering, 2026-11-06]
3. **Your own clock only.** The clan panel shows your own days, and only while
   you are at risk. Nobody below co-leader sees another member's day count
   here, and a leader sees one only through an Action they can take. [Jamie's
   ruling Q1, Q2, 2026-11-05]
4. **Modes are different games.** Your week reads one mode at a time. Casual is
   always a chip, Events only with battles in it. [Jamie's rulings Q6, A34,
   2026-11-05]
5. **A gap is unknown.** "No battle recorded this week", never that someone did
   not play. [Jamie, standing]
6. **The place in the timeline is the feed's own.** Opening Home clears the mark
   and changes nothing a connection has read. [Jamie, 2026-10-20]
7. **Follow means Friend, and never you.** With no player of your own, Find
   asks for yours first. They aren't told. [Jamie's ruling Q10, A4, 2026-11-05]

## Open

- Needs you's lag against Clan (above).
- Cheers on the player page and the battle page: the ruling names Home's
  feed; the canvas also shows them elsewhere.
- Whether the bell should carry cheers on your own items, as the design
  canvas draws ("Reactions to your items"); it carries none now.
- Whether the RSS link should be shown again later, which would mean
  keeping the link itself rather than its fingerprint.
