# Home

*Rewritten 2026-11-13 to the social layer, from the brief Jamie ratified
on 2026-10-12, under [`VISION.md`](../../VISION.md) and the rulings in
[DECISIONS](../DECISIONS.md) of 2026-11-11 and 2026-11-12. Ratified by Jamie, 2026-11-13
("I think the rest is good to go").*

## What it is for

Home is where a person keeps up with the players they follow. It is a
timeline of their play, newest first, with the person's own play in it,
told as gaming sessions and the moments around them, so you see that a
friend played twelve battles and switched decks, and cheer it. Around the
feed sit your own week and your clan. "Elixir lets you connect with your
friends and play together more in Clash Royale." [Jamie, 2026-11-11,
`VISION.md`]

Elixir is a recorder underneath, so Home says facts and leaves the
judging to the person.

## Who it serves

The signed-in person. Signing in is where Home starts: every read of
Elixir needs an account (DECISIONS "Everyone signs in; shared posts stay
public"). An agent has no Home; it reads the same timeline over MCP.

## What it holds

The product tabs are Home, Find, Clan and You, with search, Help and the
bell in the top bar; on a phone they are tabs at the foot, with the bell
beside them. The left rail is Settings' alone. [Jamie, 2026-11-12, "Home
is one feed", "The left rail stays only in Settings"]

- **Home** (`/home`): one feed of the last seven days, newest first, in
  days, with the chips Everyone, Friends, Clan and You, and All or New. A
  sitting carries its sparkline. Your week, the clan panel with this
  week's race, and People to follow sit beside the feed, below it on a
  phone. [Jamie, 2026-11-12, "Home is one feed"]
- **Find** (`/home/find`): Your clan (with Follow my clan and Invite
  clanmates), Search, From your battles, the clan directory and your
  Follow me link. [Jamie, 2026-11-12; DECISIONS "People to follow states
  why, and ranks nobody", "Invite clanmates is not on Home"]
- **You** (`/home/you`): your primary player's page once it is verified,
  with a fifth tab, Stats; your other players listed to you alone; your
  account and signing out. With no verified player, You says how to
  verify one. [Jamie, 2026-11-12, "You is your own player page, with
  Stats"]
- **The bell**, on every page: what is about you. Cheers on your items
  (counts, never who), new followers, the Clan Actions waiting for you,
  answers to your feedback and your account's own notices. [Jamie,
  2026-11-12, "The bell is what is about you"]
- **The player page** (`/home/player/<tag>`): every player name anywhere
  opens it. Its tabs are Timeline, Highlights, Moments, Follows and
  Record (the player's recorded profile and last thirty days), and Clan
  for a reader in that player's clan. [Jamie, 2026-11-12, "Every player
  name opens one player page", "Console folds into You, player pages and
  Settings"]

## Principles that decide the details

1. **The feed shows only people's play.** Sessions, moments and
   highlights of the players you follow and your own; the account's own
   lines go to the bell. [Jamie, 2026-11-12]
2. **Cheers, not comments.** A fixed set of six cheers, one per person
   per item, on an item about a player or clan you follow; shown as
   counts and "You and N others", never who. A player's words on their
   own highlight are not comments. [Jamie, 2026-11-11, 2026-11-12,
   "Reactions, not comments"]
3. **People to follow states why, and ranks nobody.** Up to five players
   from your battles, your clan and the players your follows follow, each
   with why as a fact and what following costs; never a nickname, never
   ordered by trophies, wins or any score. It is not a recommendation in
   the sense Elixir forbids: it advises nothing about the game.
   [engineering, 2026-11-12; DECISIONS "No recommendations from Elixir",
   "Elixir rates no player"]
4. **Following asks first and says its cost.** A follow from Find, the
   search sheet, the player page or a Follow me link is one confirmed act
   that names the slots it takes; following several is one act, refused
   whole past the slots left. Following from Find makes a friend, never
   your primary. The player you follow is told in the bell. [Jamie,
   2026-11-12; DECISIONS "A follow costs a slot only when Elixir records
   the player because of you", "Following from Find is a friend and never
   primary"]
5. **Home reads; it never evaluates.** The Clan Actions in the bell are
   Clan's list in Clan's order, read without raising or numbering
   anything, so they can lag Clan until its next run or visit.
   [engineering, 2026-11-05, "Home reads, it never evaluates"]
6. **Each panel for itself.** The page paints from one fast read; the
   feed and each slow panel read alone and fail alone with Try again. The
   feed is served from stored panels, so its sessions can be a little
   behind the record. A visit spends one charge on the person's hourly
   bucket. [engineering, 2026-11-06, 2026-11-12; Jamie, 2026-11-12: a
   stored feed is allowed if computing it on read cannot reach 2 s at p95]
7. **Your own clock only.** The clan panel shows your own day count, and
   only while you are at risk. Nobody below co-leader sees another
   member's count here. [Jamie, 2026-11-05, Q1, Q2]
8. **Modes are different games, and a gap is unknown.** Your week reads
   one mode at a time; "No battle recorded this week", never that
   someone did not play. [Jamie, 2026-11-05, Q6, A34; standing]
9. **The feed's place is its own.** Opening Home clears New and changes
   nothing an agent has read. [Jamie, 2026-10-20]
10. **The first steps finish for good.** "Welcome to Elixir, N of 4 done"
    (add your player, verify it, follow someone, choose your digest)
    shows until all four are done; one follow completes its step, turning
    the digest off counts as choosing it, and once finished it never
    comes back. [Jamie, 2026-11-12, "The welcome checklist finishes for
    good"]
11. **Your timeline is yours to carry.** One private RSS link to your
    feed, everyone you follow together, made, reset or turned off in
    Settings. There is no feed per player. [Jamie, 2026-11-11, "Your
    timeline is an RSS feed"]

## What it never does

Rank or score a player; show who cheered; show a nickname to anyone but
its author; put the account's own notices in the feed; evaluate a Clan
Action; carry a referral id in a Follow me link.

## Open

- Cheers on the player page and the battle page take only an item in the
  reader's own feed now. Whether an older item, or one about a player the
  reader does not follow, should show counts there, and whether a shared
  highlight shows them.
- Whether People to follow's thresholds (met twice in a week, a 2v2
  teammate once), its friends-of-follows source and clanmates in name
  order are right.
- Whether the bell should name who cheered, say when someone followed, or
  mark answers read when it is opened.
- Whether an alt should have a You page of its own; You is the primary.
- Players near you and the player map wait on a legal view of young
  players (VISION, Open); Find leaves them out.
