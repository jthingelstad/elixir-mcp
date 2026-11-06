# Home

*Rewritten from the Console's brief at step 3 of the redesign, under the
rulings in [Structure](structure.md). Home lives at `/home` and, since step 3b,
is where signing in lands and where `/console` goes.*

## What it is for

Home is where a person sees their own day: what needs them, how their week is
going, what their clan is doing, and what happened to the people they follow.
Elixir is a recorder, so Home says facts and leaves the judging to the person.

## Who it serves

The signed-in person. An agent has no Home.

## Its three tabs

- **Today** (`/home`): Needs you, Your week, the clan panel, Latest and Setup
  details. A new account gets its steps instead until the first read lands;
  they are worked out from the record each time and nothing is stored.
- **Timeline** (`/home/timeline`): the last seven days, by day, newest first.
- **Friends** (`/home/friends`): the week Wednesday's mail tells, from the
  mail's own builder.

## Principles that decide the details

1. **Needs you is Clan's list, not a second one.** The top two open Actions in
   Clan's own order and "and N more in Clan › Today". Opening Home evaluates,
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
6. **The place in the Timeline is the page's own.** Opening it clears the mark
   and changes nothing a connection has read. [Jamie, 2026-10-20]
7. **Follow means Friend, and never you.** With no player of your own, Friends
   asks for yours first. They aren't told. [Jamie's ruling Q10, A4, 2026-11-05]

## Open

- Needs you's lag against Clan (above).
- Friends' cost on a full account: up to thirty tool calls on the same builder
  as the mail. It stops adding decks near the request's deadline.
